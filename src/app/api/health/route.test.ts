import { describe, it, expect, vi } from 'vitest';
import { parseResponse } from '@/test/api-helpers';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  }),
}));

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn().mockReturnValue({
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
}));

import { GET } from './route';

describe('GET /api/health', () => {
  it('returns 200 when DB and Redis are healthy', async () => {
    const res = await GET();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.database).toBe('ok');
    expect(body.redis).toBe('ok');
  });

  it('returns 503 when DB is down', async () => {
    const { getSupabase } = await import('@/lib/supabase');
    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: { message: 'connection refused' } }),
        }),
      }),
    } as any);

    const res = await GET();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(503);
    expect((body.database as string)).toContain('error');
  });
});
