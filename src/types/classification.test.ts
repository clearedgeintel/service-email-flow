import { describe, it, expect } from 'vitest';
import { ClassificationSchema } from './classification';

describe('ClassificationSchema', () => {
  const validInput = {
    intent: 'REPAIR_REQUEST',
    confidence: 0.92,
    classification_reasons: ['Customer described a broken pipe'],
    emergency_keywords_found: [],
    customer_name: 'John Doe',
    customer_email: 'john@example.com',
    customer_phone: '555-1234',
    service_address: '123 Main St',
    preferred_times: 'Morning',
    problem_summary: 'Broken pipe in kitchen',
    trade: 'plumbing',
    urgency_level: 'THIS_WEEK',
    requested_service_type: 'Pipe Repair',
    attachments_present: false,
  };

  it('parses valid input', () => {
    const result = ClassificationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('REPAIR_REQUEST');
      expect(result.data.confidence).toBe(0.92);
      expect(result.data.trade).toBe('plumbing');
    }
  });

  it('applies defaults for missing optional fields', () => {
    const minimal = {
      intent: 'SPAM',
      confidence: 0.99,
    };
    const result = ClassificationSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.classification_reasons).toEqual(['Auto-classified']);
      expect(result.data.emergency_keywords_found).toEqual([]);
      expect(result.data.customer_name).toBeNull();
      expect(result.data.trade).toBe('unknown');
      expect(result.data.urgency_level).toBe('ROUTINE');
      expect(result.data.problem_summary).toBe('');
      expect(result.data.attachments_present).toBe(false);
    }
  });

  it('rejects invalid intent', () => {
    const result = ClassificationSchema.safeParse({
      ...validInput,
      intent: 'INVALID_INTENT',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const tooHigh = ClassificationSchema.safeParse({ ...validInput, confidence: 1.5 });
    expect(tooHigh.success).toBe(false);

    const tooLow = ClassificationSchema.safeParse({ ...validInput, confidence: -0.1 });
    expect(tooLow.success).toBe(false);
  });

  it('accepts nullable fields as null', () => {
    const result = ClassificationSchema.safeParse({
      ...validInput,
      customer_name: null,
      customer_phone: null,
      service_address: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_name).toBeNull();
      expect(result.data.customer_phone).toBeNull();
    }
  });

  it('rejects invalid trade enum', () => {
    const result = ClassificationSchema.safeParse({
      ...validInput,
      trade: 'hvac',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid urgency_level enum', () => {
    const result = ClassificationSchema.safeParse({
      ...validInput,
      urgency_level: 'ASAP',
    });
    expect(result.success).toBe(false);
  });
});
