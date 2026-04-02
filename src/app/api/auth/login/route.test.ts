import { describe, it, expect, vi } from 'vitest';
import { createRequest, parseResponse } from '@/test/api-helpers';

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn().mockResolvedValue('new-session-id'),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from './route';

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
});
