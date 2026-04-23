import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('./case-event.service', () => ({
  logCaseEvent: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { verifyCalcomSignature, processCalcomWebhook } from './calcom.service';
import { getSupabase } from '@/lib/supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

describe('verifyCalcomSignature', () => {
  const secret = 'test-secret';
  const body = '{"triggerEvent":"BOOKING_CREATED"}';

  it('accepts a valid HMAC-SHA256 signature', () => {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyCalcomSignature(body, signature, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    expect(verifyCalcomSignature(body, 'invalid', secret)).toBe(false);
  });

  it('rejects when signature is missing', () => {
    expect(verifyCalcomSignature(body, '', secret)).toBe(false);
  });

  it('rejects when secret is missing', () => {
    expect(verifyCalcomSignature(body, 'anything', '')).toBe(false);
  });
});

function buildWebhook(triggerEvent: string, overrides: Record<string, unknown> = {}) {
  return {
    triggerEvent,
    createdAt: new Date().toISOString(),
    payload: {
      uid: 'booking-uid-123',
      startTime: '2026-04-15T14:00:00Z',
      endTime: '2026-04-15T14:30:00Z',
      attendees: [{ email: 'customer@example.com' }],
      ...overrides,
    },
  };
}

describe('processCalcomWebhook', () => {
  it('returns unhandled when payload is missing required fields', async () => {
    const webhook = {
      triggerEvent: 'BOOKING_CREATED',
      createdAt: new Date().toISOString(),
      payload: {},
    };

    const result = await processCalcomWebhook(webhook as any);
    expect(result.handled).toBe(false);
    expect(result.reason).toContain('No booking data');
  });

  it('processes BOOKING_CREATED and finds matching case by email', async () => {
    const mockSb = createMockSupabase();
    // First query: check for existing booking_id (maybeSingle returns null)
    mockSb._chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // Second query chain: find case by email (select/or/not/order/limit)
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [{ id: 42 }], error: null }),
            }),
          }),
        }),
      }),
    });
    // Third call: update case
    mockSb.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const webhook = buildWebhook('BOOKING_CREATED');
    const result = await processCalcomWebhook(webhook as any);
    expect(result.handled).toBe(true);
    expect(result.caseId).toBe(42);
  });

  it('returns unhandled when no matching case is found', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const webhook = buildWebhook('BOOKING_CREATED');
    const result = await processCalcomWebhook(webhook as any);
    expect(result.handled).toBe(false);
    expect(result.reason).toContain('No matching case');
  });

  it('handles BOOKING_CANCELLED with reason', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 10 }, error: null }),
        }),
      }),
    });
    const updateMock = vi.fn().mockResolvedValue({ error: null });
    mockSb.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: updateMock }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const webhook = buildWebhook('BOOKING_CANCELLED', { cancellationReason: 'Customer unavailable' });
    const result = await processCalcomWebhook(webhook as any);
    expect(result.handled).toBe(true);
    expect(result.caseId).toBe(10);
  });

  it('matches by metadata.cleardesk_case_id when present (authoritative)', async () => {
    // Even though email lookup would pick a different case, metadata wins.
    const mockSb = createMockSupabase();

    // 1) metadata-based lookup → case 70 exists
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 70 }, error: null }),
        }),
      }),
    });
    // 2) update case 70
    mockSb.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const webhook = buildWebhook('BOOKING_CREATED', {
      metadata: { cleardesk_case_id: '70' },
    });
    const result = await processCalcomWebhook(webhook as any);
    expect(result.handled).toBe(true);
    expect(result.caseId).toBe(70);
  });

  it('falls back to email match when metadata case_id points at a non-existent case', async () => {
    const mockSb = createMockSupabase();

    // 1) metadata lookup → case 999 doesn't exist
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
    // 2) booking_id lookup → no match
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
    // 3) email fallback → case 42
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [{ id: 42 }], error: null }),
            }),
          }),
        }),
      }),
    });
    // 4) update
    mockSb.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const webhook = buildWebhook('BOOKING_CREATED', {
      metadata: { cleardesk_case_id: '999' },
    });
    const result = await processCalcomWebhook(webhook as any);
    expect(result.handled).toBe(true);
    expect(result.caseId).toBe(42);
  });

  it('returns unhandled for unknown event types', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 5 }, error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const webhook = buildWebhook('BOOKING_REJECTED');
    const result = await processCalcomWebhook(webhook as any);
    expect(result.handled).toBe(false);
    expect(result.reason).toContain('Unhandled event type');
  });
});
