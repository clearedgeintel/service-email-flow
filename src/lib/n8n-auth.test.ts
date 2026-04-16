import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./config', () => ({ invalidateConfigCache: vi.fn() }));
vi.mock('./logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { getSupabase } from './supabase';
import { getOrCreateN8nApiKey, rotateN8nApiKey, requireN8nAuth } from './n8n-auth';

const mockedGetSupabase = vi.mocked(getSupabase);

function mockSettings(existingValue: unknown) {
  const single = vi.fn().mockResolvedValue({ data: { value: existingValue } });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const client = {
    from: vi.fn((_table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single }),
      }),
      upsert,
    })),
  };
  mockedGetSupabase.mockReturnValue(client as any);
  return { upsert };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrCreateN8nApiKey', () => {
  it('returns existing key when already set', async () => {
    const existing = 'a'.repeat(64);
    const { upsert } = mockSettings(existing);
    const key = await getOrCreateN8nApiKey();
    expect(key).toBe(existing);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('generates + persists a new key when empty', async () => {
    const { upsert } = mockSettings('');
    const key = await getOrCreateN8nApiKey();
    expect(key).toHaveLength(64); // 32 bytes hex
    expect(upsert).toHaveBeenCalledWith(
      { key: 'n8n_callback_api_key', value: key },
      { onConflict: 'key' },
    );
  });

  it('generates + persists when stored value is too short', async () => {
    const { upsert } = mockSettings('short');
    const key = await getOrCreateN8nApiKey();
    expect(key).toHaveLength(64);
    expect(upsert).toHaveBeenCalled();
  });
});

describe('rotateN8nApiKey', () => {
  it('always generates a new key', async () => {
    const { upsert } = mockSettings('a'.repeat(64));
    const newKey = await rotateN8nApiKey();
    expect(newKey).toHaveLength(64);
    expect(newKey).not.toBe('a'.repeat(64));
    expect(upsert).toHaveBeenCalled();
  });
});

describe('requireN8nAuth', () => {
  const buildRequest = (header: string | null) => {
    const headers = new Headers();
    if (header) headers.set('authorization', header);
    return { headers } as unknown as NextRequest;
  };

  it('returns 401 when no Authorization header', async () => {
    mockSettings('k'.repeat(64));
    const res = await requireN8nAuth(buildRequest(null));
    expect(res?.status).toBe(401);
  });

  it('returns 401 when header is not Bearer', async () => {
    mockSettings('k'.repeat(64));
    const res = await requireN8nAuth(buildRequest('Basic abc'));
    expect(res?.status).toBe(401);
  });

  it('returns 401 when token does not match', async () => {
    mockSettings('k'.repeat(64));
    const res = await requireN8nAuth(buildRequest('Bearer wrong-key'));
    expect(res?.status).toBe(401);
  });

  it('returns null when token matches', async () => {
    const key = 'k'.repeat(64);
    mockSettings(key);
    const res = await requireN8nAuth(buildRequest(`Bearer ${key}`));
    expect(res).toBeNull();
  });

  it('handles case-insensitive Bearer prefix', async () => {
    const key = 'k'.repeat(64);
    mockSettings(key);
    const res = await requireN8nAuth(buildRequest(`bearer ${key}`));
    expect(res).toBeNull();
  });
});
