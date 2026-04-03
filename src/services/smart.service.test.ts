import { describe, it, expect, vi } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { recordFeedback, getFeedbackStats, getCustomerProfile, getTrends } from './smart.service';
import { getSupabase } from '@/lib/supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

describe('recordFeedback', () => {
  it('records feedback and applies corrections', async () => {
    const mockSb = createMockSupabase({
      data: { intent: 'GENERAL_QUESTION', urgency_level: 'ROUTINE', trade: 'unknown', confidence: 0.65 },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await recordFeedback({
      caseId: 1,
      correctedIntent: 'REPAIR_REQUEST',
      correctedTrade: 'plumbing',
    });

    // Should have called from() for: select case, insert feedback, update case
    expect(mockSb.from).toHaveBeenCalledWith('email_cases');
    expect(mockSb.from).toHaveBeenCalledWith('classification_feedback');
  });

  it('throws when case not found', async () => {
    const mockSb = createMockSupabase({ data: null, error: { message: 'not found' } });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await expect(recordFeedback({ caseId: 999 })).rejects.toThrow('Case #999 not found');
  });
});

describe('getFeedbackStats', () => {
  it('calculates accuracy rate from feedback records', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          { original_intent: 'SPAM', corrected_intent: 'GENERAL_QUESTION' },
          { original_intent: 'REPAIR_REQUEST', corrected_intent: 'REPAIR_REQUEST' },
          { original_intent: 'BILLING', corrected_intent: 'VENDOR' },
        ],
        error: null,
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const stats = await getFeedbackStats();
    expect(stats.totalFeedback).toBe(3);
    expect(stats.accuracyRate).toBeCloseTo(1 / 3); // 1 correct out of 3
    expect(stats.intentCorrections).toHaveProperty('SPAM → GENERAL_QUESTION');
  });

  it('returns defaults when no feedback exists', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const stats = await getFeedbackStats();
    expect(stats.totalFeedback).toBe(0);
    expect(stats.accuracyRate).toBe(1);
  });
});

describe('getCustomerProfile', () => {
  it('builds profile from case history', async () => {
    const cases = [
      { id: 1, received_at: '2025-01-01T00:00:00Z', trade: 'plumbing', intent: 'REPAIR_REQUEST', urgency_level: 'ROUTINE', status: 'CLOSED' },
      { id: 2, received_at: '2025-06-01T00:00:00Z', trade: 'electric', intent: 'SALES_INQUIRY', urgency_level: 'THIS_WEEK', status: 'RESPONDED_PENDING_BOOKING' },
    ];
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: cases, error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const profile = await getCustomerProfile('test@example.com');
    expect(profile).not.toBeNull();
    expect(profile!.totalCases).toBe(2);
    expect(profile!.isRepeat).toBe(true);
    expect(profile!.trades).toContain('plumbing');
    expect(profile!.trades).toContain('electric');
    expect(profile!.openCases).toBe(1);
  });

  it('returns null when no cases found', async () => {
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const profile = await getCustomerProfile('nobody@example.com');
    expect(profile).toBeNull();
  });
});

describe('getTrends', () => {
  it('groups cases by week and computes trends', async () => {
    const now = new Date();
    const cases = [
      { received_at: now.toISOString(), intent: 'REPAIR_REQUEST', trade: 'plumbing', urgency_level: 'ROUTINE', confidence: 0.9 },
      { received_at: now.toISOString(), intent: 'EMERGENCY', trade: 'electric', urgency_level: 'EMERGENCY', confidence: 0.95 },
    ];
    const mockSb = createMockSupabase();
    mockSb.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: cases, error: null }),
        }),
      }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const trends = await getTrends(7);
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0].totalCases).toBe(2);
    expect(trends[0].intentTrends).toHaveProperty('REPAIR_REQUEST');
    expect(trends[0].avgConfidence).toBeGreaterThan(0);
  });
});
