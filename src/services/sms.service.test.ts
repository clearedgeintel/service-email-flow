import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/tenant', () => ({
  getDefaultTenantId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-00000000d3fa'),
}));
vi.mock('./case-event.service', () => ({ logCaseEvent: vi.fn() }));
vi.mock('./webhook.service', () => ({ emitWebhookEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Twilio SDK — mock both default callable and the static validateRequest
const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => {
  const fn = vi.fn(() => ({ messages: { create: mockMessagesCreate } }));
  (fn as unknown as { validateRequest: ReturnType<typeof vi.fn> }).validateRequest = vi.fn();
  return { default: fn };
});

import twilio from 'twilio';
import {
  verifyTwilioSignature,
  processInboundSms,
  processStatusCallback,
  sendOutboundSms,
  isTwilioEnabled,
} from './sms.service';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { logCaseEvent } from './case-event.service';
import { emitWebhookEvent } from './webhook.service';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedGetConfig = vi.mocked(getConfig);
const mockedLogEvent = vi.mocked(logCaseEvent);
const mockedEmit = vi.mocked(emitWebhookEvent);
const mockedValidate = vi.mocked((twilio as unknown as { validateRequest: ReturnType<typeof vi.fn> }).validateRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyTwilioSignature', () => {
  it('returns false when token or signature missing', () => {
    expect(verifyTwilioSignature('', 'sig', 'url', {})).toBe(false);
    expect(verifyTwilioSignature('tok', '', 'url', {})).toBe(false);
  });

  it('delegates to twilio.validateRequest', () => {
    mockedValidate.mockReturnValue(true);
    expect(verifyTwilioSignature('tok', 'sig', 'https://x/y', { From: '+1' })).toBe(true);
    expect(mockedValidate).toHaveBeenCalledWith('tok', 'sig', 'https://x/y', { From: '+1' });
  });

  it('returns false when validateRequest throws', () => {
    mockedValidate.mockImplementation(() => { throw new Error('nope'); });
    expect(verifyTwilioSignature('tok', 'sig', 'url', {})).toBe(false);
  });
});

describe('isTwilioEnabled', () => {
  it('true when boolean true or "true"', async () => {
    mockedGetConfig.mockResolvedValue(true);
    expect(await isTwilioEnabled()).toBe(true);
    mockedGetConfig.mockResolvedValue('true');
    expect(await isTwilioEnabled()).toBe(true);
  });

  it('false when boolean false or "false"', async () => {
    mockedGetConfig.mockResolvedValue(false);
    expect(await isTwilioEnabled()).toBe(false);
    mockedGetConfig.mockResolvedValue('false');
    expect(await isTwilioEnabled()).toBe(false);
  });
});

describe('processInboundSms', () => {
  const baseParams = {
    MessageSid: 'SM123',
    From: '+15551234567',
    To: '+15559999999',
    Body: 'AC not working',
    NumMedia: '0',
  };

  it('short-circuits on replay (existing twilio_sid)', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 7, case_id: 42 } }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await processInboundSms(baseParams);
    expect(result).toEqual({ handled: true, caseId: 42, messageId: 7 });
    expect(mockedLogEvent).not.toHaveBeenCalled();
  });

  it('links to existing open case by phone tail-match', async () => {
    const mockSb = createMockSupabase();
    // 1. dedupe check — no existing message
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
    });
    // 2. findCaseByPhone — returns one open case, matching on last 10 digits
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
    // 3. insert sms_messages row
    mockSb.from.mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 11 }, error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await processInboundSms(baseParams);
    expect(result.caseId).toBe(99);
    expect(result.messageId).toBe(11);
    expect(mockedLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 99, eventType: 'RECEIVED', actor: 'sms',
    }));
    expect(mockedEmit).toHaveBeenCalledWith('sms.received', 99, expect.objectContaining({
      twilio_sid: 'SM123', from: '+15551234567',
    }));
  });

  it('creates a new case when no phone match exists', async () => {
    const mockSb = createMockSupabase();
    // 1. dedupe — no existing
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
    });
    // 2. findCaseByPhone — no cases
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
    // 3. insert email_cases — new case id 77
    mockSb.from.mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 77 }, error: null }),
        }),
      }),
    });
    // 4. insert sms_messages
    mockSb.from.mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 22 }, error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await processInboundSms(baseParams);
    expect(result.caseId).toBe(77);
    expect(result.messageId).toBe(22);
  });

  it('captures media URLs from MMS', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
    });
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ id: 10, customer_phone: '+15551234567' }],
              }),
            }),
          }),
        }),
      }),
    });
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
      }),
    });
    mockSb.from.mockReturnValueOnce({ insert: insertSpy });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await processInboundSms({
      ...baseParams,
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/media/a.jpg',
      MediaUrl1: 'https://api.twilio.com/media/b.jpg',
    });

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      num_media: 2,
      media_urls: [
        'https://api.twilio.com/media/a.jpg',
        'https://api.twilio.com/media/b.jpg',
      ],
    }));
  });
});

describe('processStatusCallback', () => {
  it('updates sms row with delivery status', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    mockedGetSupabase.mockReturnValue({ from: vi.fn(() => ({ update })) } as any);

    await processStatusCallback({ MessageSid: 'SM1', MessageStatus: 'delivered' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'delivered',
      delivered_at: expect.any(String),
    }));
  });

  it('captures error code on failed delivery', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    mockedGetSupabase.mockReturnValue({ from: vi.fn(() => ({ update })) } as any);

    await processStatusCallback({
      MessageSid: 'SM2',
      MessageStatus: 'failed',
      ErrorCode: '30003',
      ErrorMessage: 'Unreachable',
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error_code: '30003',
      error_message: 'Unreachable',
    }));
  });
});

describe('sendOutboundSms', () => {
  it('throws when credentials are missing', async () => {
    mockedGetConfig.mockResolvedValue('');
    await expect(
      sendOutboundSms({ caseId: 1, toNumber: '+15551112222', body: 'hi' }),
    ).rejects.toThrow(/credentials not configured/i);
  });

  it('sends via twilio, persists row, emits webhook', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => {
      const vals: Record<string, string> = {
        twilio_account_sid: 'AC123',
        twilio_auth_token: 'token',
        twilio_from_number: '+15550000000',
      };
      return vals[key] ?? '';
    });
    mockMessagesCreate.mockResolvedValue({ sid: 'SMout1', status: 'queued' });

    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 55 }, error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await sendOutboundSms({
      caseId: 42,
      toNumber: '+15551112222',
      body: 'Your tech is on the way',
    });

    expect(result).toEqual({ messageId: 55, twilioSid: 'SMout1' });
    expect(mockMessagesCreate).toHaveBeenCalledWith({
      from: '+15550000000',
      to: '+15551112222',
      body: 'Your tech is on the way',
    });
    expect(mockedEmit).toHaveBeenCalledWith('sms.sent', 42, expect.objectContaining({
      twilio_sid: 'SMout1',
    }));
  });
});
