import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('@/lib/n8n-auth', () => ({ requireN8nAuth: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => null) }));
vi.mock('@/services/case-event.service', () => ({ logCaseEvent: vi.fn() }));
vi.mock('@/services/webhook.service', () => ({ emitWebhookEvent: vi.fn() }));
vi.mock('@/services/followup.service', () => ({ sendFollowup: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { POST } from './route';
import { getSupabase } from '@/lib/supabase';
import { requireN8nAuth } from '@/lib/n8n-auth';
import { logCaseEvent } from '@/services/case-event.service';
import { emitWebhookEvent } from '@/services/webhook.service';
import { sendFollowup } from '@/services/followup.service';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedRequireAuth = vi.mocked(requireN8nAuth);
const mockedLogEvent = vi.mocked(logCaseEvent);
const mockedEmit = vi.mocked(emitWebhookEvent);
const mockedFollowup = vi.mocked(sendFollowup);

function buildRequest(body: unknown) {
  return {
    headers: new Headers({ authorization: 'Bearer test-key', 'x-forwarded-for': '1.2.3.4' }),
    json: async () => body,
  } as unknown as NextRequest;
}

function mockCaseExists(caseId: number) {
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'email_cases') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: caseId, status: 'CLASSIFIED', notes: '' }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {} as any;
    }),
  };
  mockedGetSupabase.mockReturnValue(client as any);
  return client;
}

function mockCaseNotFound() {
  const client = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    })),
  };
  mockedGetSupabase.mockReturnValue(client as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireAuth.mockResolvedValue(null);
});

describe('POST /api/n8n/callback', () => {
  it('returns 401 when auth fails', async () => {
    const { NextResponse } = await import('next/server');
    mockedRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 }));
    const res = await POST(buildRequest({ action: 'add_note', case_id: 1, note: 'x' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid action', async () => {
    mockCaseExists(1);
    const res = await POST(buildRequest({ action: 'bogus_action', case_id: 1 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on malformed payload', async () => {
    mockCaseExists(1);
    const res = await POST(buildRequest({ action: 'add_note', case_id: 1 })); // missing note
    expect(res.status).toBe(400);
  });

  it('returns 404 when case does not exist', async () => {
    mockCaseNotFound();
    const res = await POST(buildRequest({ action: 'add_note', case_id: 999, note: 'hi' }));
    expect(res.status).toBe(404);
  });

  it('add_note logs event + emits webhook', async () => {
    mockCaseExists(42);
    const res = await POST(buildRequest({
      action: 'add_note',
      case_id: 42,
      note: 'On-call tech notified via SMS',
      actor: 'n8n-emergency-flow',
    }));
    expect(res.status).toBe(200);
    expect(mockedLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 42,
      eventType: 'NOTE_ADDED',
      actor: 'n8n-emergency-flow',
    }));
    expect(mockedEmit).toHaveBeenCalledWith('case.note_added', 42, expect.objectContaining({
      note: 'On-call tech notified via SMS',
      source: 'n8n',
    }));
  });

  it('update_status changes status + logs STATUS_CHANGED', async () => {
    mockCaseExists(42);
    const res = await POST(buildRequest({
      action: 'update_status',
      case_id: 42,
      status: 'NEEDS_REVIEW',
      reason: 'External ticket reopened',
    }));
    expect(res.status).toBe(200);
    expect(mockedLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'STATUS_CHANGED',
      metadata: { status: 'NEEDS_REVIEW', reason: 'External ticket reopened' },
    }));
  });

  it('close_case sets CLOSED + emits case.closed', async () => {
    mockCaseExists(42);
    const res = await POST(buildRequest({
      action: 'close_case',
      case_id: 42,
      disposition: 'Customer cancelled',
    }));
    expect(res.status).toBe(200);
    expect(mockedLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'CLOSED',
    }));
    expect(mockedEmit).toHaveBeenCalledWith('case.closed', 42, expect.objectContaining({
      closed_by: 'n8n',
      disposition: 'Customer cancelled',
    }));
  });

  it('trigger_followup calls sendFollowup', async () => {
    mockCaseExists(42);
    const res = await POST(buildRequest({ action: 'trigger_followup', case_id: 42 }));
    expect(res.status).toBe(200);
    expect(mockedFollowup).toHaveBeenCalledWith(42);
  });

  it('add_event accepts free-form event with metadata', async () => {
    mockCaseExists(42);
    const res = await POST(buildRequest({
      action: 'add_event',
      case_id: 42,
      event_type: 'TECH_NOTIFIED',
      summary: 'SMS sent to +15559998888',
      metadata: { twilio_sid: 'SM123' },
    }));
    expect(res.status).toBe(200);
    expect(mockedLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TECH_NOTIFIED',
      summary: 'SMS sent to +15559998888',
      metadata: { twilio_sid: 'SM123' },
    }));
  });

  it('add_event falls back to NOTE_ADDED on unknown event_type', async () => {
    mockCaseExists(42);
    const res = await POST(buildRequest({
      action: 'add_event',
      case_id: 42,
      event_type: 'SOMETHING_WEIRD',
      summary: 'x',
    }));
    expect(res.status).toBe(200);
    expect(mockedLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'NOTE_ADDED',
    }));
  });
});
