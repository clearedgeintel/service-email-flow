import { describe, it, expect, vi } from 'vitest';
import { createMockSupabase } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockResolvedValue(0.70),
}));

vi.mock('./case-event.service', () => ({
  logCaseEvent: vi.fn(),
}));

vi.mock('@/lib/gmail', () => ({
  getGmail: vi.fn().mockReturnValue({
    users: {
      messages: {
        modify: vi.fn().mockResolvedValue({}),
      },
    },
  }),
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { routeCase } from './router.service';
import { getSupabase } from '@/lib/supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

function makeCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    intent: 'REPAIR_REQUEST',
    confidence: '0.92',
    urgency_level: 'THIS_WEEK',
    trade: 'plumbing',
    emergency_keywords_found: [],
    classification_reasons: ['leak'],
    gmail_message_id: 'msg-123',
    notes: '',
    ...overrides,
  };
}

describe('routeCase', () => {
  it('routes EMERGENCY to ESCALATED with both notification flags', async () => {
    const mockSb = createMockSupabase({
      data: makeCaseRow({ intent: 'EMERGENCY', confidence: '0.95' }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await routeCase(1);
    expect(result.newStatus).toBe('ESCALATED');
    expect(result.requiresTechNotify).toBe(true);
    expect(result.requiresCustomerReply).toBe(true);
  });

  it('routes REPAIR_REQUEST to RESPONDED_PENDING_BOOKING', async () => {
    const mockSb = createMockSupabase({
      data: makeCaseRow({ intent: 'REPAIR_REQUEST', confidence: '0.90' }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await routeCase(1);
    expect(result.newStatus).toBe('RESPONDED_PENDING_BOOKING');
    expect(result.requiresTechNotify).toBe(true);
    expect(result.requiresCustomerReply).toBe(true);
  });

  it('routes SALES_INQUIRY to RESPONDED_PENDING_BOOKING with customer reply only', async () => {
    const mockSb = createMockSupabase({
      data: makeCaseRow({ intent: 'SALES_INQUIRY', confidence: '0.85' }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await routeCase(1);
    expect(result.newStatus).toBe('RESPONDED_PENDING_BOOKING');
    expect(result.requiresCustomerReply).toBe(true);
    expect(result.requiresTechNotify).toBe(false);
  });

  it('routes GENERAL_QUESTION same as SALES_INQUIRY', async () => {
    const mockSb = createMockSupabase({
      data: makeCaseRow({ intent: 'GENERAL_QUESTION', confidence: '0.80' }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await routeCase(1);
    expect(result.newStatus).toBe('RESPONDED_PENDING_BOOKING');
    expect(result.requiresCustomerReply).toBe(true);
  });

  it('routes BILLING/VENDOR/JOB_APPLICANT to NEEDS_REVIEW', async () => {
    for (const intent of ['BILLING', 'VENDOR', 'JOB_APPLICANT']) {
      const mockSb = createMockSupabase({
        data: makeCaseRow({ intent, confidence: '0.90' }),
      });
      mockedGetSupabase.mockReturnValue(mockSb as any);

      const result = await routeCase(1);
      expect(result.newStatus).toBe('NEEDS_REVIEW');
    }
  });

  it('routes SPAM to CLOSED', async () => {
    const mockSb = createMockSupabase({
      data: makeCaseRow({ intent: 'SPAM', confidence: '0.99' }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await routeCase(1);
    expect(result.newStatus).toBe('CLOSED');
  });

  it('routes low confidence to NEEDS_REVIEW regardless of intent', async () => {
    const mockSb = createMockSupabase({
      data: makeCaseRow({ intent: 'REPAIR_REQUEST', confidence: '0.40' }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await routeCase(1);
    expect(result.newStatus).toBe('NEEDS_REVIEW');
    expect(result.routeReason).toContain('Low confidence');
  });

  it('routes unknown intent to NEEDS_REVIEW', async () => {
    const mockSb = createMockSupabase({
      data: makeCaseRow({ intent: 'UNKNOWN_THING', confidence: '0.90' }),
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const result = await routeCase(1);
    expect(result.newStatus).toBe('NEEDS_REVIEW');
    expect(result.routeReason).toContain('unrecognized intent');
  });

  it('throws when case not found', async () => {
    const mockSb = createMockSupabase({
      data: null,
      error: { message: 'not found' },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await expect(routeCase(999)).rejects.toThrow('Case #999 not found');
  });
});
