import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { signPayload, generateWebhookSecret, deliverWebhook } from './webhook.service';
import { getSupabase } from '@/lib/supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('signPayload', () => {
  it('returns HMAC-SHA256 hex', () => {
    const sig = signPayload('{"x":1}', 'secret');
    const expected = crypto.createHmac('sha256', 'secret').update('{"x":1}').digest('hex');
    expect(sig).toBe(expected);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different signatures for different bodies', () => {
    const a = signPayload('{"x":1}', 'secret');
    const b = signPayload('{"x":2}', 'secret');
    expect(a).not.toBe(b);
  });
});

describe('generateWebhookSecret', () => {
  it('returns a 64-char hex string', () => {
    const s = generateWebhookSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique values', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe('deliverWebhook', () => {
  function mockSubscription(active: boolean = true) {
    const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const subscriptionChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 1, url: 'https://example.com/hook', secret: 'test-secret', active },
            error: null,
          }),
        }),
      }),
    };
    const deliveryInsertChain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 42 }, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({ eq: updateEqMock }),
    };
    let callCount = 0;
    return {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? subscriptionChain : deliveryInsertChain;
      }),
      updateEqMock,
    };
  }

  it('returns subscription-not-found when sub is missing', async () => {
    const sb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
          }),
        }),
      }),
    };
    mockedGetSupabase.mockReturnValue(sb as any);

    const result = await deliverWebhook(999, 'case.created', 1, { event: 'case.created' }, 1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Subscription not found');
  });

  it('silently succeeds when subscription is disabled', async () => {
    const sb = mockSubscription(false);
    mockedGetSupabase.mockReturnValue(sb as any);

    const result = await deliverWebhook(1, 'case.created', 1, {}, 1);
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it('posts with correct signature headers and returns success on 200', async () => {
    const sb = mockSubscription(true);
    mockedGetSupabase.mockReturnValue(sb as any);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'OK',
    } as unknown as Response);
    global.fetch = fetchMock;

    const payload = { event: 'case.created', case_id: 42 };
    const result = await deliverWebhook(1, 'case.created', 42, payload, 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-ClearDesk-Event']).toBe('case.created');
    expect(headers['X-ClearDesk-Signature-256']).toMatch(/^[0-9a-f]{64}$/);

    // Verify signature is correct HMAC of the body
    const expectedSig = crypto.createHmac('sha256', 'test-secret')
      .update(JSON.stringify(payload))
      .digest('hex');
    expect(headers['X-ClearDesk-Signature-256']).toBe(expectedSig);
  });

  it('returns failure with HTTP status on non-OK response', async () => {
    const sb = mockSubscription(true);
    mockedGetSupabase.mockReturnValue(sb as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } as unknown as Response);

    const result = await deliverWebhook(1, 'case.created', 1, {}, 1);
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toContain('500');
  });

  it('returns failure on network error', async () => {
    const sb = mockSubscription(true);
    mockedGetSupabase.mockReturnValue(sb as any);

    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await deliverWebhook(1, 'case.created', 1, {}, 1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});
