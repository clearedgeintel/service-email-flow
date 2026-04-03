import { describe, it, expect, vi } from 'vitest';
import { parseResponse } from '@/test/api-helpers';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({ data: [], count: 0 }),
          lt: vi.fn().mockResolvedValue({ data: [], count: 0 }),
        }),
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ data: [], count: 0 }),
          lt: vi.fn().mockResolvedValue({ data: [], count: 0 }),
        }),
        limit: vi.fn().mockResolvedValue({ data: [], count: 5, error: null }),
      }),
    }),
  }),
}));

import { GET } from './route';

describe('GET /api/metrics', () => {
  it('returns metrics JSON with expected structure', async () => {
    const res = await GET();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.timestamp).toBeDefined();
    expect(body.cases).toBeDefined();
    expect(body.performance).toBeDefined();
    expect(body.classification).toBeDefined();
    expect(body.errors).toBeDefined();
  });
});
