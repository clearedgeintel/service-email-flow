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

const TEST_USER_ID = '00000000-0000-0000-0000-00000000a0ad';
const TEST_TENANT_ID = '00000000-0000-0000-0000-00000000d3fa';

describe('createSession', () => {
  it('inserts a session row with userId + tenantId and returns a UUID', async () => {
    const mockSb = createMockSupabase();
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const id = await createSession(TEST_USER_ID, TEST_TENANT_ID);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockSb.from).toHaveBeenCalledWith('sessions');
  });
});

describe('validateSession', () => {
  it('returns true for a valid non-expired session in the new sessions table', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const mockSb = createMockSupabase({
      data: { id: 'test-id', expires_at: future },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await validateSession('test-id');
    expect(result).toBe(true);
  });

  it('returns false when session not found in either table', async () => {
    const mockSb = createMockSupabase({ data: null });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await validateSession('nonexistent');
    expect(result).toBe(false);
  });
});

describe('destroySession', () => {
  it('deletes from both new sessions and legacy admin_sessions tables', async () => {
    const mockSb = createMockSupabase();
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await destroySession('test-id');
    const tablesTouched = mockSb.from.mock.calls.map((c: any[]) => c[0]);
    expect(tablesTouched).toContain('sessions');
    expect(tablesTouched).toContain('admin_sessions');
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
