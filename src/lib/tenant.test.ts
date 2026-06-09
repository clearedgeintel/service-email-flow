import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  getDefaultTenantId,
  getTenantById,
  getTenantBySlug,
  _resetDefaultTenantCache,
} from './tenant';
import { getSupabase } from './supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

function mockTenantsTable(result: { data: unknown; error?: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  mockedGetSupabase.mockReturnValue({ from } as any);
  return { from, select, eq, single };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetDefaultTenantCache();
});

describe('getDefaultTenantId', () => {
  it('returns the id of the seeded default tenant', async () => {
    mockTenantsTable({ data: { id: 'tnt-default-uuid' } });
    expect(await getDefaultTenantId()).toBe('tnt-default-uuid');
  });

  it('caches the lookup — second call hits memory, not the DB', async () => {
    const m = mockTenantsTable({ data: { id: 'tnt-default-uuid' } });
    await getDefaultTenantId();
    await getDefaultTenantId();
    await getDefaultTenantId();
    expect(m.from).toHaveBeenCalledTimes(1);
  });

  it('throws actionable error when the seed row is missing', async () => {
    mockTenantsTable({ data: null, error: { message: 'no rows' } });
    await expect(getDefaultTenantId()).rejects.toThrow(/migration 021/i);
  });

  it('_resetDefaultTenantCache forces a refetch', async () => {
    const m = mockTenantsTable({ data: { id: 'tnt-a' } });
    await getDefaultTenantId();
    _resetDefaultTenantCache();
    await getDefaultTenantId();
    expect(m.from).toHaveBeenCalledTimes(2);
  });
});

describe('getTenantById', () => {
  it('returns the full tenant row when found', async () => {
    mockTenantsTable({
      data: {
        id: 't1',
        slug: 'acme',
        name: 'Acme Inc',
        status: 'active',
        plan: 'pro',
        created_at: '2026-04-23T00:00:00Z',
        updated_at: '2026-04-23T00:00:00Z',
      },
    });
    const t = await getTenantById('t1');
    expect(t?.slug).toBe('acme');
    expect(t?.plan).toBe('pro');
  });

  it('returns null when the tenant is not found', async () => {
    mockTenantsTable({ data: null, error: { message: 'not found' } });
    expect(await getTenantById('does-not-exist')).toBeNull();
  });
});

describe('getTenantBySlug', () => {
  it('looks up by slug — supports the future subdomain router', async () => {
    const m = mockTenantsTable({
      data: { id: 't1', slug: 'profix', name: 'ProFix Electric', status: 'active', plan: 'starter', created_at: '', updated_at: '' },
    });

    const t = await getTenantBySlug('profix');
    expect(t?.slug).toBe('profix');
    expect(m.eq).toHaveBeenCalledWith('slug', 'profix');
  });

  it('returns null when slug is not registered', async () => {
    mockTenantsTable({ data: null, error: { message: 'not found' } });
    expect(await getTenantBySlug('nope')).toBeNull();
  });
});
