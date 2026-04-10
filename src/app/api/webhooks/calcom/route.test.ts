import { describe, it, expect, vi } from 'vitest';
import { parseResponse } from '@/test/api-helpers';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockReturnValue(null),
}));

vi.mock('@/services/calcom.service', () => ({
  verifyCalcomSignature: vi.fn().mockReturnValue(true),
  processCalcomWebhook: vi.fn().mockResolvedValue({ handled: true, caseId: 42 }),
  CalcomWebhookPayload: {},
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from './route';
import { verifyCalcomSignature, processCalcomWebhook } from '@/services/calcom.service';
import { rateLimit } from '@/lib/rate-limit';

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/webhooks/calcom', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('POST /api/webhooks/calcom', () => {
  it('accepts a valid webhook and returns 200', async () => {
    delete process.env.CALCOM_WEBHOOK_SECRET;
    const req = buildRequest({ triggerEvent: 'BOOKING_CREATED', payload: {} });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.case_id).toBe(42);
  });

  it('returns 401 when signature verification fails', async () => {
    process.env.CALCOM_WEBHOOK_SECRET = 'test-secret';
    vi.mocked(verifyCalcomSignature).mockReturnValueOnce(false);

    const req = buildRequest({ triggerEvent: 'BOOKING_CREATED' }, { 'x-cal-signature-256': 'bad' });
    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(401);

    delete process.env.CALCOM_WEBHOOK_SECRET;
  });

  it('returns 400 when triggerEvent is missing', async () => {
    delete process.env.CALCOM_WEBHOOK_SECRET;
    const req = buildRequest({ payload: {} });

    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(rateLimit).mockReturnValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
    );

    const req = buildRequest({ triggerEvent: 'BOOKING_CREATED' });
    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(429);
  });

  it('returns 500 when processing throws', async () => {
    delete process.env.CALCOM_WEBHOOK_SECRET;
    vi.mocked(processCalcomWebhook).mockRejectedValueOnce(new Error('DB error'));

    const req = buildRequest({ triggerEvent: 'BOOKING_CREATED' });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(500);
    expect(body.error).toContain('DB error');
  });
});
