import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/test/api-helpers';

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn().mockResolvedValue('new-session-id'),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockReturnValue(null), // not rate limited by default
}));

vi.mock('@/lib/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('@/lib/tenant', () => ({
  getDefaultTenantId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-00000000d3fa'),
}));
vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$12$mockhash'),
  verifyPassword: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { POST } from './route';
import { rateLimit } from '@/lib/rate-limit';
import { getSupabase } from '@/lib/supabase';
import { verifyPassword } from '@/lib/password';

const mockedRateLimit = vi.mocked(rateLimit);
const mockedGetSupabase = vi.mocked(getSupabase);
const mockedVerifyPassword = vi.mocked(verifyPassword);

/**
 * Build a Supabase mock that returns `userLookup` for the users-table
 * single() and accepts any insert/update silently. Covers both the bootstrap
 * "no user exists" and "user exists" flows.
 */
function buildSupabaseMock(userLookup: { data: any } = { data: null }) {
  const maybeSingle = vi.fn().mockResolvedValue(userLookup);
  const single = vi.fn().mockResolvedValue({
    data: { id: '00000000-0000-0000-0000-00000000a0ad' },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle, single, ilike: vi.fn().mockReturnValue({ maybeSingle, single }) });
  const ilike = vi.fn().mockReturnValue({ maybeSingle, single, eq });
  const select = vi.fn().mockReturnValue({ eq, ilike, maybeSingle, single });
  const insertSelect = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select: insertSelect });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  return { from: vi.fn(() => ({ select, insert, update })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRateLimit.mockReturnValue(null);
});

describe('POST /api/auth/login — ADMIN_PASSWORD bootstrap path', () => {
  it('returns 200 when password matches and bootstraps a user', async () => {
    process.env.ADMIN_PASSWORD = 'test-password';
    // No bootstrap user exists → login route should INSERT one
    mockedGetSupabase.mockReturnValue(buildSupabaseMock({ data: null }) as any);

    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { password: 'test-password' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 200 when password matches and bootstrap user already exists', async () => {
    process.env.ADMIN_PASSWORD = 'test-password';
    mockedGetSupabase.mockReturnValue(
      buildSupabaseMock({ data: { id: '00000000-0000-0000-0000-00000000a0ad' } }) as any,
    );

    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { password: 'test-password' },
    });

    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(200);
  });

  it('returns 401 on wrong password', async () => {
    process.env.ADMIN_PASSWORD = 'test-password';
    mockedGetSupabase.mockReturnValue(buildSupabaseMock() as any);
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
});

describe('POST /api/auth/login — email + password path', () => {
  it('returns 200 when email + password verify against a real user', async () => {
    mockedGetSupabase.mockReturnValue(
      buildSupabaseMock({
        data: {
          id: '00000000-0000-0000-0000-00000000a0ad',
          tenant_id: '00000000-0000-0000-0000-00000000d3fa',
          password_hash: '$2b$12$realhash',
          role: 'admin',
        },
      }) as any,
    );
    mockedVerifyPassword.mockResolvedValue(true);

    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: 'real-password' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 401 when email does not match any user', async () => {
    mockedGetSupabase.mockReturnValue(buildSupabaseMock({ data: null }) as any);

    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'noone@example.com', password: 'whatever' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/email or password/i);
  });

  it('returns 401 when password does not verify', async () => {
    mockedGetSupabase.mockReturnValue(
      buildSupabaseMock({
        data: {
          id: '00000000-0000-0000-0000-00000000a0ad',
          tenant_id: '00000000-0000-0000-0000-00000000d3fa',
          password_hash: '$2b$12$realhash',
          role: 'admin',
        },
      }) as any,
    );
    mockedVerifyPassword.mockResolvedValue(false);

    const req = createRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: 'wrong-password' },
    });

    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(401);
  });
});

describe('POST /api/auth/login — rate limit', () => {
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
