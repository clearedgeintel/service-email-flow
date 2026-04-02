import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

// Mock supabase before importing config
vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

import { getConfig, invalidateConfigCache } from './config';
import { getSupabase } from './supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

beforeEach(() => {
  invalidateConfigCache();
});

describe('getConfig', () => {
  it('returns DB value when present', async () => {
    const mockSb = createMockSupabase({ data: { value: 'ProFix Electric' } });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await getConfig('business_name');
    expect(result).toBe('ProFix Electric');
    expect(mockSb.from).toHaveBeenCalledWith('settings');
  });

  it('falls back to env var when DB returns nothing', async () => {
    const mockSb = createMockSupabase({ data: { value: null } });
    mockedGetSupabase.mockReturnValue(mockSb as any);
    process.env.BUSINESS_NAME = 'EnvBiz';

    const result = await getConfig('business_name');
    expect(result).toBe('EnvBiz');

    delete process.env.BUSINESS_NAME;
  });

  it('falls back to default when DB and env miss', async () => {
    const mockSb = createMockSupabase({ data: null });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await getConfig('nonexistent_key', 'fallback');
    expect(result).toBe('fallback');
  });

  it('throws when no value found and no default', async () => {
    const mockSb = createMockSupabase({ data: null });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await expect(getConfig('missing_key_no_default')).rejects.toThrow('not found');
  });

  it('returns cached value within TTL', async () => {
    const mockSb = createMockSupabase({ data: { value: 'cached-val' } });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await getConfig('cache_test');
    await getConfig('cache_test');

    // from() should only be called once due to caching
    expect(mockSb.from).toHaveBeenCalledTimes(1);
  });

  it('invalidateConfigCache clears the cache', async () => {
    const mockSb = createMockSupabase({ data: { value: 'first' } });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await getConfig('invalidate_test');
    invalidateConfigCache();
    await getConfig('invalidate_test');

    expect(mockSb.from).toHaveBeenCalledTimes(2);
  });
});
