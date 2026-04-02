import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { createSession, validateSession, destroySession, requireAuth } from './auth';
import { getSupabase } from './supabase';
import { cookies } from 'next/headers';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedCookies = vi.mocked(cookies);

describe('createSession', () => {
  it('inserts a session and returns a UUID', async () => {
    const mockSb = createMockSupabase();
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const id = await createSession();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockSb.from).toHaveBeenCalledWith('admin_sessions');
  });
});

describe('validateSession', () => {
  it('returns true for a valid non-expired session', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const mockSb = createMockSupabase({
      data: { id: 'test-id', expires_at: future },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await validateSession('test-id');
    expect(result).toBe(true);
  });

  it('returns false and deletes expired session', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const mockSb = createMockSupabase({
      data: { id: 'expired-id', expires_at: past },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await validateSession('expired-id');
    expect(result).toBe(false);
  });

  it('returns false when session not found', async () => {
    const mockSb = createMockSupabase({ data: null });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await validateSession('nonexistent');
    expect(result).toBe(false);
  });
});

describe('destroySession', () => {
  it('deletes the session', async () => {
    const mockSb = createMockSupabase();
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await destroySession('test-id');
    expect(mockSb.from).toHaveBeenCalledWith('admin_sessions');
  });
});

describe('requireAuth', () => {
  it('returns null when session is valid', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const mockSb = createMockSupabase({
      data: { id: 'valid-session', expires_at: future },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const mockCookieStore = {
      get: vi.fn().mockReturnValue({ value: 'valid-session' }),
      set: vi.fn(),
    };
    mockedCookies.mockResolvedValue(mockCookieStore as any);

    const result = await requireAuth();
    expect(result).toBeNull();
  });

  it('returns 401 when no cookie present', async () => {
    const mockCookieStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };
    mockedCookies.mockResolvedValue(mockCookieStore as any);

    const result = await requireAuth();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns 401 when session is expired', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const mockSb = createMockSupabase({
      data: { id: 'expired', expires_at: past },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const mockCookieStore = {
      get: vi.fn().mockReturnValue({ value: 'expired' }),
      set: vi.fn(),
    };
    mockedCookies.mockResolvedValue(mockCookieStore as any);

    const result = await requireAuth();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});
