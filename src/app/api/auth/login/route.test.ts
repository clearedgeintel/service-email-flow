import { describe, it, expect, vi } from 'vitest';
import { createRequest, parseResponse } from '@/test/api-helpers';

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn().mockResolvedValue('new-session-id'),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockReturnValue(null), // not rate limited by default
}));

import { POST } from './route';
import { rateLimit } from '@/lib/rate-limit';

const mockedRateLimit = vi.mocked(rateLimit);

describe('POST /api/auth/login', () => {
  it('returns 200 on correct password', async () => {
    process.env.ADMIN_PASSWORD = 'test-password';
    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { password: 'test-password' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    process.env.ADMIN_PASSWORD = 'test-password';
    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { password: 'wrong-password' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toBe('Invalid password');
  });

  it('returns 400 on missing password', async () => {
    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: {},
    });

    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    const { NextResponse } = await import('next/server');
    mockedRateLimit.mockReturnValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
    );

    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { password: 'test' },
    });

    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(429);
  });
});
