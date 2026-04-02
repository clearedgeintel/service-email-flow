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

import { lookupPricing, formatPricingForPrompt } from './pricing.service';
import { getSupabase } from '@/lib/supabase';

const mockedGetSupabase = vi.mocked(getSupabase);

const sampleItems = [
  { id: 1, trade: 'plumbing', service: 'Faucet Replacement', keywords: ['faucet', 'tap'], price_min: 175, price_max: 400, unit: 'per faucet', active: true },
  { id: 2, trade: 'plumbing', service: 'Pipe Leak Repair', keywords: ['leak', 'pipe leak'], price_min: 200, price_max: 600, unit: 'per repair', active: true },
  { id: 3, trade: 'electric', service: 'Outlet Installation', keywords: ['outlet', 'plug'], price_min: 150, price_max: 300, unit: 'per outlet', active: true },
];

describe('lookupPricing', () => {
  it('returns items matching keywords in search text', async () => {
    const mockSb = createMockSupabase();
    // Override the chain to return sampleItems when awaited
    mockSb._chain.eq.mockImplementation(() => {
      return { then: (resolve: (val: unknown) => void) => resolve({ data: sampleItems, error: null }) };
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const results = await lookupPricing('I have a faucet leak in my kitchen');
    expect(results.length).toBe(2);
    expect(results.map(r => r.service)).toContain('Faucet Replacement');
    expect(results.map(r => r.service)).toContain('Pipe Leak Repair');
  });

  it('returns empty array on DB error', async () => {
    const mockSb = createMockSupabase();
    mockSb._chain.eq.mockImplementation(() => {
      return { then: (resolve: (val: unknown) => void) => resolve({ data: null, error: { message: 'db error' } }) };
    });
    mockedGetSupabase.mockReturnValue(mockSb as any);

    const results = await lookupPricing('anything');
    expect(results).toEqual([]);
  });
});

describe('formatPricingForPrompt', () => {
  it('formats items as readable text', () => {
    const result = formatPricingForPrompt([
      { service: 'Faucet Replacement', price_min: 175, price_max: 400, unit: 'per faucet', id: 1, trade: 'plumbing', keywords: [], active: true, created_at: '', updated_at: '' },
    ] as any);
    expect(result).toContain('Faucet Replacement');
    expect(result).toContain('$175');
    expect(result).toContain('$400');
    expect(result).toContain('per faucet');
  });

  it('joins multiple items with newlines', () => {
    const result = formatPricingForPrompt([
      { service: 'A', price_min: 100, price_max: 200, unit: 'each' },
      { service: 'B', price_min: 300, price_max: 400, unit: 'each' },
    ] as any);
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result.split('\n').length).toBe(2);
  });
});
