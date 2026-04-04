import { describe, it, expect, vi } from 'vitest';
import { createMockSupabase, createMockAnthropic } from '@/test/mocks';

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/anthropic', () => ({
  getAnthropic: vi.fn(),
  getModel: vi.fn().mockReturnValue('claude-sonnet-4-20250514'),
}));

vi.mock('./case-event.service', () => ({
  logCaseEvent: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { classifyCase } from './classifier.service';
import { getSupabase } from '@/lib/supabase';
import { getAnthropic } from '@/lib/anthropic';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedGetOpenAI = vi.mocked(getAnthropic);

const sampleCase = {
  id: 1,
  from_name: 'John',
  from_email: 'john@test.com',
  subject: 'Broken pipe',
  body_cleaned: 'My kitchen pipe is leaking badly',
  body_raw: 'My kitchen pipe is leaking badly',
  snippet: 'pipe leaking',
  has_attachments: false,
};

const validClassification = {
  intent: 'REPAIR_REQUEST',
  confidence: 0.92,
  classification_reasons: ['Pipe leak described'],
  emergency_keywords_found: [],
  customer_name: 'John',
  customer_email: 'john@test.com',
  customer_phone: null,
  service_address: null,
  preferred_times: null,
  problem_summary: 'Kitchen pipe leaking',
  trade: 'plumbing',
  urgency_level: 'THIS_WEEK',
  requested_service_type: 'Pipe Repair',
  attachments_present: false,
};

describe('classifyCase', () => {
  it('classifies with high confidence and sets CLASSIFIED status', async () => {
    const mockSb = createMockSupabase({ data: sampleCase });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const mockAI = createMockAnthropic(JSON.stringify(validClassification));
    mockedGetOpenAI.mockReturnValue(mockAI as any);

    const result = await classifyCase(1);
    expect(result.intent).toBe('REPAIR_REQUEST');
    expect(result.confidence).toBe(0.92);

    // Verify DB update was called with CLASSIFIED status
    const updateCall = mockSb._chain.update.mock.calls[0][0];
    expect(updateCall.status).toBe('CLASSIFIED');
    expect(updateCall.intent).toBe('REPAIR_REQUEST');
  });

  it('sets NEEDS_REVIEW when confidence is low', async () => {
    const lowConfidence = { ...validClassification, confidence: 0.45 };
    const mockSb = createMockSupabase({ data: sampleCase });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const mockAI = createMockAnthropic(JSON.stringify(lowConfidence));
    mockedGetOpenAI.mockReturnValue(mockAI as any);

    const result = await classifyCase(1);
    expect(result.confidence).toBe(0.45);

    const updateCall = mockSb._chain.update.mock.calls[0][0];
    expect(updateCall.status).toBe('NEEDS_REVIEW');
  });

  it('handles markdown-wrapped JSON from LLM', async () => {
    const wrapped = '```json\n' + JSON.stringify(validClassification) + '\n```';
    const mockSb = createMockSupabase({ data: sampleCase });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const mockAI = createMockAnthropic(wrapped);
    mockedGetOpenAI.mockReturnValue(mockAI as any);

    const result = await classifyCase(1);
    expect(result.intent).toBe('REPAIR_REQUEST');
  });

  it('returns fallback classification on invalid JSON', async () => {
    const mockSb = createMockSupabase({ data: sampleCase });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const mockAI = createMockAnthropic('this is not json at all');
    mockedGetOpenAI.mockReturnValue(mockAI as any);

    const result = await classifyCase(1);
    expect(result.intent).toBe('GENERAL_QUESTION');
    expect(result.confidence).toBe(0.3);
    expect(result.problem_summary).toContain('Classification failed');
  });

  it('throws when case is not found', async () => {
    const mockSb = createMockSupabase({
      data: null,
      error: { message: 'not found' },
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    await expect(classifyCase(999)).rejects.toThrow('Case #999 not found');
  });

  it('throws when DB update fails', async () => {
    const mockSb = createMockSupabase({ data: sampleCase });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    // Make update chain return an error
    mockSb._chain.update.mockImplementation(() => {
      return new Proxy(mockSb._chain, {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: (val: unknown) => void) =>
              resolve({ data: null, error: null });
          }
          if (prop === 'eq') {
            return vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'update failed' },
            });
          }
          return target[prop as string];
        },
      });
    });

    const mockAI = createMockAnthropic(JSON.stringify(validClassification));
    mockedGetOpenAI.mockReturnValue(mockAI as any);

    await expect(classifyCase(1)).rejects.toThrow('Failed to update case #1');
  });
});
