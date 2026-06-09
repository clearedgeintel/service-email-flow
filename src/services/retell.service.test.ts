import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}));

vi.mock('./case-event.service', () => ({
  logCaseEvent: vi.fn(),
}));

vi.mock('@/lib/business-hours', () => ({
  getBusinessHoursConfig: vi.fn(),
  isAfterHours: vi.fn(),
  describeBusinessHours: vi.fn(() => 'Mon-Fri 08:00-17:00 America/New_York'),
}));

vi.mock('@/lib/tenant', () => ({
  getDefaultTenantId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-00000000d3fa'),
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./webhook.service', () => ({
  emitWebhookEvent: vi.fn(),
}));

// Mock Retell SDK — we're not testing their HMAC, just that we call it
vi.mock('retell-sdk', () => ({
  default: {
    verify: vi.fn(),
  },
}));

import Retell from 'retell-sdk';
import {
  verifyRetellSignature,
  processRetellWebhook,
  isRetellEnabled,
  extractTranscriptTurns,
  buildInboundResponse,
} from './retell.service';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { getBusinessHoursConfig, isAfterHours } from '@/lib/business-hours';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedGetConfig = vi.mocked(getConfig);
const mockedVerify = vi.mocked(Retell.verify);
const mockedHoursConfig = vi.mocked(getBusinessHoursConfig);
const mockedIsAfterHours = vi.mocked(isAfterHours);

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: business hours disabled so isAfterHours returns false
  mockedHoursConfig.mockResolvedValue({
    enabled: false, start: '08:00', end: '17:00',
    weekdays: [1, 2, 3, 4, 5], timezone: 'America/New_York',
  });
  mockedIsAfterHours.mockReturnValue(false);
});

describe('verifyRetellSignature', () => {
  it('returns false when signature or key is missing', async () => {
    expect(await verifyRetellSignature('body', '', 'key')).toBe(false);
    expect(await verifyRetellSignature('body', 'sig', '')).toBe(false);
  });

  it('delegates to Retell SDK verify and passes args through', async () => {
    mockedVerify.mockResolvedValue(true);
    const result = await verifyRetellSignature('raw body', 'sig-abc', 'key-123');
    expect(result).toBe(true);
    expect(mockedVerify).toHaveBeenCalledWith('raw body', 'key-123', 'sig-abc');
  });

  it('returns false when Retell SDK throws', async () => {
    mockedVerify.mockImplementation(() => {
      throw new Error('bad signature');
    });
    expect(await verifyRetellSignature('body', 'sig', 'key')).toBe(false);
  });
});

describe('isRetellEnabled', () => {
  it('returns true when setting is boolean true', async () => {
    mockedGetConfig.mockResolvedValue(true);
    expect(await isRetellEnabled()).toBe(true);
  });

  it('returns true when setting is string "true" (legacy)', async () => {
    mockedGetConfig.mockResolvedValue('true');
    expect(await isRetellEnabled()).toBe(true);
  });

  it('returns false when setting is boolean false', async () => {
    mockedGetConfig.mockResolvedValue(false);
    expect(await isRetellEnabled()).toBe(false);
  });

  it('returns false when setting is string "false"', async () => {
    mockedGetConfig.mockResolvedValue('false');
    expect(await isRetellEnabled()).toBe(false);
  });
});

describe('buildInboundResponse', () => {
  it('returns dynamic variables pulled from settings + business hours', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => {
      const vals: Record<string, string> = {
        business_name: 'ACME HVAC',
        business_phone: '+15551112222',
        retell_after_hours_agent_id: '',
      };
      return vals[key] ?? '';
    });
    mockedHoursConfig.mockResolvedValue({
      enabled: true, start: '08:00', end: '17:00',
      weekdays: [1, 2, 3, 4, 5], timezone: 'America/New_York',
    });
    mockedIsAfterHours.mockReturnValue(false);

    // no caller match — findCaseForCall returns null via empty query
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const resp = await buildInboundResponse('+15559998888');
    expect(resp.call_inbound.dynamic_variables).toMatchObject({
      business_name: 'ACME HVAC',
      business_phone: '+15551112222',
      is_after_hours: 'false',
    });
    expect(resp.call_inbound.override_agent_id).toBeUndefined();
    expect(resp.call_inbound.metadata).toMatchObject({ after_hours: false });
  });

  it('sets override_agent_id to after-hours agent when after hours + configured', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => {
      const vals: Record<string, string> = {
        business_name: 'ACME',
        business_phone: '',
        retell_after_hours_agent_id: 'agent_night_1',
      };
      return vals[key] ?? '';
    });
    mockedHoursConfig.mockResolvedValue({
      enabled: true, start: '08:00', end: '17:00',
      weekdays: [1, 2, 3, 4, 5], timezone: 'America/New_York',
    });
    mockedIsAfterHours.mockReturnValue(true);

    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const resp = await buildInboundResponse('+15559998888');
    expect(resp.call_inbound.override_agent_id).toBe('agent_night_1');
    expect(resp.call_inbound.dynamic_variables?.is_after_hours).toBe('true');
    expect(resp.call_inbound.metadata).toMatchObject({ after_hours: true });
  });

  it('omits override when after hours but no after-hours agent configured', async () => {
    mockedGetConfig.mockResolvedValue('');
    mockedHoursConfig.mockResolvedValue({
      enabled: true, start: '08:00', end: '17:00',
      weekdays: [1, 2, 3, 4, 5], timezone: 'America/New_York',
    });
    mockedIsAfterHours.mockReturnValue(true);

    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const resp = await buildInboundResponse('+15559998888');
    expect(resp.call_inbound.override_agent_id).toBeUndefined();
    expect(resp.call_inbound.dynamic_variables?.is_after_hours).toBe('true');
  });
});

describe('extractTranscriptTurns', () => {
  it('normalizes Retell transcript_object, stripping word-level timing', () => {
    const result = extractTranscriptTurns(
      [
        { role: 'agent', content: '  Hi  ', words: [{ word: 'Hi' }] },
        { role: 'user', content: 'Hello back' },
        { role: 'other', content: 'ignored' },
      ],
      null,
    );
    expect(result).toEqual([
      { role: 'agent', content: 'Hi' },
      { role: 'user', content: 'Hello back' },
    ]);
  });

  it('falls back to parsing "Agent:/User:" lines from raw transcript', () => {
    const result = extractTranscriptTurns(
      null,
      'Agent: Hello\nCustomer: Hi there\nAgent: How can I help?',
    );
    expect(result).toEqual([
      { role: 'agent', content: 'Hello' },
      { role: 'user', content: 'Hi there' },
      { role: 'agent', content: 'How can I help?' },
    ]);
  });

  it('returns empty array when no transcript data present', () => {
    expect(extractTranscriptTurns(null, null)).toEqual([]);
    expect(extractTranscriptTurns([], '')).toEqual([]);
  });
});

describe('processRetellWebhook', () => {
  function buildPayload(event: string, overrides: Record<string, unknown> = {}) {
    return {
      event: event as 'call_started' | 'call_ended' | 'call_analyzed',
      call: {
        call_id: 'call_test_123',
        direction: 'inbound' as const,
        from_number: '+15551234567',
        to_number: '+15559876543',
        agent_id: 'agent_1',
        start_timestamp: 1700000000000,
        end_timestamp: 1700000120000,
        ...overrides,
      },
    };
  }

  it('returns unhandled for unknown event types', async () => {
    const mockSb = createMockSupabase();
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await processRetellWebhook({
      event: 'transfer_started' as never,
      call: { call_id: 'c1' },
    });
    expect(result.handled).toBe(false);
    expect(result.action).toBe('ignored');
  });

  it('upserts call row on call_started', async () => {
    const mockSb = createMockSupabase();
    // findCaseForCall returns [] so no case match
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        }),
      }),
    });
    // Upsert returns ok
    mockSb.from.mockReturnValueOnce({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await processRetellWebhook(buildPayload('call_started'));
    expect(result.handled).toBe(true);
    expect(result.action).toBe('started');
    expect(result.callId).toBe('call_test_123');
  });

  it('links call_started to existing case by tail-matching phone number', async () => {
    const mockSb = createMockSupabase();
    // findCaseForCall returns a matching case (last 10 digits match)
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ id: 99, customer_phone: '(555) 123-4567' }],
              }),
            }),
          }),
        }),
      }),
    });
    mockSb.from.mockReturnValueOnce({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await processRetellWebhook(buildPayload('call_started'));
    expect(result.caseId).toBe(99);
  });

  it('creates case from inbound call_analyzed when no match exists', async () => {
    const mockSb = createMockSupabase();

    // 1) look up existing call row — returns no case_id
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { case_id: null } }),
        }),
      }),
    });
    // 2) createCaseFromCall insert
    mockSb.from.mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 77 }, error: null }),
        }),
      }),
    });
    // 3) upsertCall
    mockSb.from.mockReturnValueOnce({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await processRetellWebhook(
      buildPayload('call_analyzed', {
        call_analysis: {
          call_summary: 'Customer has a water heater issue',
          user_sentiment: 'Negative',
          call_successful: true,
          in_voicemail: false,
          custom_analysis_data: {
            caller_name: 'Jane Doe',
            problem: 'No hot water since yesterday',
            trade: 'plumbing',
            urgency: 'TODAY',
          },
        },
      }),
    );

    expect(result.handled).toBe(true);
    expect(result.action).toBe('analyzed');
    expect(result.caseId).toBe(77);
  });

  it('logs VOICE_TRANSCRIPT case event with structured turns on call_analyzed', async () => {
    const { logCaseEvent } = await import('./case-event.service');
    const mockSb = createMockSupabase();

    // existing call row already linked
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { case_id: 42 } }),
        }),
      }),
    });
    // upsert call row
    mockSb.from.mockReturnValueOnce({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await processRetellWebhook(
      buildPayload('call_analyzed', {
        transcript_object: [
          { role: 'agent', content: 'Hello, how can I help?', words: [{ w: 'Hello' }] },
          { role: 'user', content: 'My AC is broken.' },
          { role: 'agent', content: 'Got it, let me get a tech out.' },
        ],
        recording_url: 'https://retell.example/rec.mp3',
        call_analysis: {
          call_summary: 'Customer AC broken',
          user_sentiment: 'Neutral',
          call_successful: true,
          in_voicemail: false,
        },
      }),
    );

    expect(logCaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 42,
        eventType: 'VOICE_TRANSCRIPT',
        actor: 'retell',
        metadata: expect.objectContaining({
          retell_call_id: 'call_test_123',
          direction: 'inbound',
          recording_url: 'https://retell.example/rec.mp3',
          sentiment: 'Neutral',
          turns: [
            { role: 'agent', content: 'Hello, how can I help?' },
            { role: 'user', content: 'My AC is broken.' },
            { role: 'agent', content: 'Got it, let me get a tech out.' },
          ],
        }),
      }),
    );
  });

  it('emits case.ended webhook event on call_ended', async () => {
    const { emitWebhookEvent } = await import('./webhook.service');
    const mockSb = createMockSupabase();
    // look up existing call
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { case_id: 10 } }),
        }),
      }),
    });
    // upsert
    mockSb.from.mockReturnValueOnce({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await processRetellWebhook(buildPayload('call_ended'));

    expect(emitWebhookEvent).toHaveBeenCalledWith(
      'call.ended',
      10,
      expect.objectContaining({
        retell_call_id: 'call_test_123',
        direction: 'inbound',
      }),
    );
  });
});
