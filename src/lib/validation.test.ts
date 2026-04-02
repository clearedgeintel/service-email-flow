import { describe, it, expect } from 'vitest';
import {
  CaseUpdateSchema,
  CaseNoteSchema,
  CaseQuerySchema,
  PricingCreateSchema,
  SettingsUpdateSchema,
} from './validation';

describe('CaseUpdateSchema', () => {
  it('accepts valid status update', () => {
    const result = CaseUpdateSchema.safeParse({ status: 'ESCALATED' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = CaseUpdateSchema.safeParse({ status: 'FAKE_STATUS' });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    const result = CaseUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts multiple valid fields', () => {
    const result = CaseUpdateSchema.safeParse({
      status: 'CLASSIFIED',
      urgency_level: 'TODAY',
      trade: 'plumbing',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid trade', () => {
    const result = CaseUpdateSchema.safeParse({ trade: 'hvac' });
    expect(result.success).toBe(false);
  });
});

describe('CaseNoteSchema', () => {
  it('accepts valid note', () => {
    const result = CaseNoteSchema.safeParse({ note: 'Customer called back' });
    expect(result.success).toBe(true);
  });

  it('rejects empty note', () => {
    const result = CaseNoteSchema.safeParse({ note: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing note', () => {
    const result = CaseNoteSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('CaseQuerySchema', () => {
  it('applies defaults for empty input', () => {
    const result = CaseQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(25);
      expect(result.data.sort).toBe('received_at');
      expect(result.data.order).toBe('desc');
    }
  });

  it('coerces string numbers', () => {
    const result = CaseQuerySchema.safeParse({ page: '3', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    }
  });

  it('rejects limit over 100', () => {
    const result = CaseQuerySchema.safeParse({ limit: '200' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid sort field', () => {
    const result = CaseQuerySchema.safeParse({ sort: 'malicious_field' });
    expect(result.success).toBe(false);
  });
});

describe('PricingCreateSchema', () => {
  it('accepts valid pricing item', () => {
    const result = PricingCreateSchema.safeParse({
      trade: 'electric',
      service: 'Outlet Install',
      keywords: ['outlet', 'plug'],
      price_min: 150,
      price_max: 300,
    });
    expect(result.success).toBe(true);
  });

  it('accepts comma-separated keywords string', () => {
    const result = PricingCreateSchema.safeParse({
      trade: 'plumbing',
      service: 'Faucet Repair',
      keywords: 'faucet, tap, sink',
      price_min: 100,
      price_max: 200,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keywords).toEqual(['faucet', 'tap', 'sink']);
    }
  });

  it('rejects price_max less than price_min', () => {
    const result = PricingCreateSchema.safeParse({
      trade: 'electric',
      service: 'Test',
      keywords: ['test'],
      price_min: 500,
      price_max: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid trade', () => {
    const result = PricingCreateSchema.safeParse({
      trade: 'hvac',
      service: 'Test',
      keywords: ['test'],
      price_min: 100,
      price_max: 200,
    });
    expect(result.success).toBe(false);
  });
});

describe('SettingsUpdateSchema', () => {
  it('accepts valid key-value pairs', () => {
    const result = SettingsUpdateSchema.safeParse({
      business_name: 'New Name',
      confidence_threshold: 0.80,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = SettingsUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
