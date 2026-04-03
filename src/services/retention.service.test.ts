import { describe, it, expect, vi } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockResolvedValue(48),
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { cleanupExpiredSessions, archiveOldCases, exportCustomerData, forgetCustomer } from './retention.service';
import { getSupabase } from '@/lib/supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

describe('cleanupExpiredSessions', () => {
  it('deletes expired sessions and returns count', async () => {
    const mockSb = createMockSupabase();
    mockSb._chain.lt.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: '1' }, { id: '2' }], error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const count = await cleanupExpiredSessions();
    expect(count).toBe(2);
    expect(mockSb.from).toHaveBeenCalledWith('admin_sessions');
  });

  it('returns 0 on error', async () => {
    const mockSb = createMockSupabase();
    mockSb._chain.lt.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const count = await cleanupExpiredSessions();
    expect(count).toBe(0);
  });
});

describe('archiveOldCases', () => {
  it('archives closed cases older than retention period', async () => {
    const mockSb = createMockSupabase();
    mockSb._chain.lt.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const count = await archiveOldCases();
    expect(count).toBe(3);
  });
});

describe('exportCustomerData', () => {
  it('returns cases and events for a customer email', async () => {
    const mockSb = createMockSupabase();
    const cases = [{ id: 1, customer_email: 'test@example.com' }];
    const events = [{ id: 10, case_id: 1, event_type: 'RECEIVED' }];

    // First call: cases query
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: cases, error: null }),
        }),
      }),
    });
    // Second call: events query
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: events, error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await exportCustomerData('test@example.com');
    expect(result.cases).toHaveLength(1);
    expect(result.events).toHaveLength(1);
  });

  it('returns empty arrays when no data found', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await exportCustomerData('nobody@example.com');
    expect(result.cases).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });
});

describe('forgetCustomer', () => {
  it('anonymizes cases and deletes events', async () => {
    const mockSb = createMockSupabase();

    // First call: find cases
    mockSb.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null }),
      }),
    });
    // Second call: anonymize cases
    mockSb.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    // Third call: delete events
    mockSb.from.mockReturnValueOnce({
      delete: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: 10 }, { id: 11 }], error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await forgetCustomer('test@example.com');
    expect(result.casesAnonymized).toBe(2);
    expect(result.eventsDeleted).toBe(2);
  });

  it('returns zeros when no cases found', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await forgetCustomer('nobody@example.com');
    expect(result.casesAnonymized).toBe(0);
    expect(result.eventsDeleted).toBe(0);
  });
});
