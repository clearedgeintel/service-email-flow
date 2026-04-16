import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/anthropic', () => ({
  getAnthropic: vi.fn(),
  getModel: vi.fn(() => 'claude-sonnet-test'),
}));
vi.mock('@/lib/circuit-breaker', () => ({
  withCircuitBreaker: vi.fn(async (_opts: any, primary: any, fallback: any) => {
    try {
      const result = await primary();
      return { result, usedFallback: false };
    } catch {
      return { result: await fallback(), usedFallback: true };
    }
  }),
}));
vi.mock('./sms.service', () => ({
  sendOutboundSms: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  composeAndSendSmsReply,
  isSmsAutoReplyEnabled,
} from './sms-reply.service';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { getAnthropic } from '@/lib/anthropic';
import { sendOutboundSms } from './sms.service';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedGetConfig = vi.mocked(getConfig);
const mockedGetAnthropic = vi.mocked(getAnthropic);
const mockedSendSms = vi.mocked(sendOutboundSms);

function setConfig(overrides: Record<string, unknown>) {
  const defaults: Record<string, unknown> = {
    sms_auto_reply_enabled: true,
    sms_auto_reply_throttle_minutes: 2,
    business_name: 'ACME Plumbing',
    business_phone: '+15551234567',
  };
  const merged = { ...defaults, ...overrides };
  mockedGetConfig.mockImplementation(async (key: string) => (merged[key] ?? '') as any);
}

function mockSupabase({
  caseRow = {
    id: 42,
    customer_name: 'Jane',
    customer_phone: '+15559998888',
    problem_summary: 'AC not cooling',
    trade: 'hvac',
    urgency_level: 'TODAY',
    intent: 'REPAIR_REQUEST',
  },
  throttleHistory = [] as Array<{ id: number }>,
  conversation = [] as Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>,
}: {
  caseRow?: any;
  throttleHistory?: Array<{ id: number }>;
  conversation?: Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>;
} = {}) {
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'email_cases') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: caseRow }),
            }),
          }),
        };
      }
      if (table === 'sms_messages') {
        // Two distinct queries hit sms_messages: (1) throttle check with eq + eq + gte + limit,
        // (2) history load with eq + order + limit. Distinguish by chain shape.
        const throttleChain = {
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: throttleHistory }),
        };
        const historyChain = {
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: conversation }),
        };

        return {
          select: vi.fn((cols: string) => {
            // Throttle query selects just 'id'; history selects direction, body, created_at.
            if (cols.includes('direction')) return historyChain;
            return throttleChain;
          }),
        };
      }
      return {} as any;
    }),
  };
  mockedGetSupabase.mockReturnValue(client as any);
  return client;
}

function mockClaudeReply(text: string) {
  mockedGetAnthropic.mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text }],
      }),
    },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isSmsAutoReplyEnabled', () => {
  it('returns true when setting is boolean or string true', async () => {
    mockedGetConfig.mockResolvedValue(true);
    expect(await isSmsAutoReplyEnabled()).toBe(true);
    mockedGetConfig.mockResolvedValue('true');
    expect(await isSmsAutoReplyEnabled()).toBe(true);
  });

  it('returns false otherwise', async () => {
    mockedGetConfig.mockResolvedValue(false);
    expect(await isSmsAutoReplyEnabled()).toBe(false);
    mockedGetConfig.mockResolvedValue('false');
    expect(await isSmsAutoReplyEnabled()).toBe(false);
  });
});

describe('composeAndSendSmsReply', () => {
  it('skips when auto-reply disabled', async () => {
    setConfig({ sms_auto_reply_enabled: false });
    const result = await composeAndSendSmsReply({ caseId: 42, inboundBody: 'hi' });
    expect(result).toEqual({ sent: false, reason: 'disabled' });
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('skips when throttled (recent outbound SMS within window)', async () => {
    setConfig({});
    mockSupabase({ throttleHistory: [{ id: 1 }] });
    const result = await composeAndSendSmsReply({ caseId: 42, inboundBody: 'hi' });
    expect(result).toEqual({ sent: false, reason: 'throttled' });
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('skips when case has no customer_phone', async () => {
    setConfig({});
    mockSupabase({ caseRow: { id: 42, customer_name: null, customer_phone: null, problem_summary: null, trade: null, urgency_level: null, intent: null } });
    const result = await composeAndSendSmsReply({ caseId: 42, inboundBody: 'hi' });
    expect(result).toEqual({ sent: false, reason: 'no_phone' });
  });

  it('calls Claude and sends via Twilio', async () => {
    setConfig({});
    mockSupabase();
    mockClaudeReply('Hi Jane, tech will call back in ~30 min. For emergency, call +15551234567.');
    mockedSendSms.mockResolvedValue({ messageId: 99, twilioSid: 'SMauto1' });

    const result = await composeAndSendSmsReply({
      caseId: 42,
      inboundBody: 'My AC still isn\'t working',
    });

    expect(result).toEqual({ sent: true, twilioSid: 'SMauto1' });
    expect(mockedSendSms).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 42,
      toNumber: '+15559998888',
      actor: 'auto-sms-reply',
    }));
    expect(mockedSendSms.mock.calls[0][0].body).toContain('Jane');
  });

  it('truncates overlong Claude replies to SMS length', async () => {
    setConfig({});
    mockSupabase();
    const longReply = 'A'.repeat(500);
    mockClaudeReply(longReply);
    mockedSendSms.mockResolvedValue({ messageId: 100, twilioSid: 'SMauto2' });

    await composeAndSendSmsReply({ caseId: 42, inboundBody: 'help' });

    const sentBody = mockedSendSms.mock.calls[0][0].body;
    expect(sentBody.length).toBeLessThanOrEqual(320);
    expect(sentBody.endsWith('…')).toBe(true);
  });

  it('falls back to template when Claude throws', async () => {
    setConfig({});
    mockSupabase();
    mockedGetAnthropic.mockReturnValue({
      messages: {
        create: vi.fn().mockRejectedValue(new Error('anthropic 500')),
      },
    } as any);
    mockedSendSms.mockResolvedValue({ messageId: 101, twilioSid: 'SMauto3' });

    const result = await composeAndSendSmsReply({ caseId: 42, inboundBody: 'help' });
    expect(result.sent).toBe(true);
    const body = mockedSendSms.mock.calls[0][0].body;
    expect(body).toContain('Jane'); // fallback uses first name
    expect(body).toContain('+15551234567'); // fallback includes business phone
  });
});
