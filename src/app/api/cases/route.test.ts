import { describe, it, expect, vi } from 'vitest';
import { createRequest, parseResponse } from '@/test/api-helpers';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue(null), // authenticated by default
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

import { GET } from './route';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedRequireAuth = vi.mocked(requireAuth);

describe('GET /api/cases', () => {
  it('returns paginated cases', async () => {
    const mockSb = createMockSupabase();
    const cases = [
      { id: 1, subject: 'Test case', status: 'RECEIVED' },
      { id: 2, subject: 'Another case', status: 'CLASSIFIED' },
    ];
    // Override range to return cases with count
    mockSb._chain.range.mockResolvedValue({ data: cases, error: null, count: 2 });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const req = createRequest('/api/cases');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.cases).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
  });

  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockedRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const req = createRequest('/api/cases');
    const res = await GET(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(401);
  });

  it('passes filter params to query', async () => {
    const mockSb = createMockSupabase();
    mockSb._chain.range.mockResolvedValue({ data: [], error: null, count: 0 });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const req = createRequest('/api/cases', {
      searchParams: { status: 'ESCALATED', intent: 'EMERGENCY' },
    });
    await GET(req);

    // Verify eq was called for filters
    expect(mockSb._chain.eq).toHaveBeenCalled();
  });
});
