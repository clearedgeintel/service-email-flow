import { describe, it, expect, vi } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/tenant', () => ({
  getDefaultTenantId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-00000000d3fa'),
}));

import { logCaseEvent, getCaseTimeline } from './case-event.service';
import { getSupabase } from '@/lib/supabase';
import { EventType } from '@/types/events';

const mockedGetSupabase = vi.mocked(getSupabase);

describe('logCaseEvent', () => {
  it('inserts an event row', async () => {
    const mockSb = createMockSupabase();
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await logCaseEvent({
      caseId: 1,
      eventType: EventType.CLASSIFIED,
      summary: 'Classified as REPAIR_REQUEST',
      metadata: { confidence: 0.92 },
    });

    expect(mockSb.from).toHaveBeenCalledWith('case_events');
    const insertArg = mockSb._chain.insert.mock.calls[0][0];
    expect(insertArg.case_id).toBe(1);
    expect(insertArg.event_type).toBe('CLASSIFIED');
    expect(insertArg.actor).toBe('system');
    expect(insertArg.summary).toBe('Classified as REPAIR_REQUEST');
  });

  it('uses custom actor when provided', async () => {
    const mockSb = createMockSupabase();
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await logCaseEvent({
      caseId: 1,
      eventType: EventType.NOTE_ADDED,
      actor: 'admin',
      summary: 'Manual note',
    });

    const insertArg = mockSb._chain.insert.mock.calls[0][0];
    expect(insertArg.actor).toBe('admin');
  });

  it('does not throw on DB error (logs instead)', async () => {
    const mockSb = createMockSupabase({
      error: { message: 'insert failed' },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    // Should not throw
    await logCaseEvent({
      caseId: 1,
      eventType: EventType.ERROR,
      summary: 'Test error',
    });
  });
});

describe('getCaseTimeline', () => {
  it('returns events ordered by created_at', async () => {
    const events = [
      { id: 1, case_id: 1, event_type: 'RECEIVED', actor: 'system', summary: 'Received', metadata: null, created_at: '2025-01-01T00:00:00Z' },
      { id: 2, case_id: 1, event_type: 'CLASSIFIED', actor: 'system', summary: 'Classified', metadata: null, created_at: '2025-01-01T00:01:00Z' },
    ];
    const mockSb = createMockSupabase();
    mockSb._chain.order.mockReturnValue({
      then: (resolve: (val: unknown) => void) => resolve({ data: events, error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await getCaseTimeline(1);
    expect(result).toHaveLength(2);
    expect(result[0].event_type).toBe('RECEIVED');
  });

  it('returns empty array on error', async () => {
    const mockSb = createMockSupabase();
    mockSb._chain.order.mockReturnValue({
      then: (resolve: (val: unknown) => void) => resolve({ data: null, error: { message: 'fail' } }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await getCaseTimeline(1);
    expect(result).toEqual([]);
  });
});
