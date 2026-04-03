import { describe, it, expect } from 'vitest';
import { generateCorrelationId, createCorrelatedLogger } from './logger';

describe('generateCorrelationId', () => {
  it('returns a valid UUID', () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
  });
});

describe('createCorrelatedLogger', () => {
  it('returns a logger and correlation ID', () => {
    const { logger, correlationId } = createCorrelatedLogger('test-worker');
    expect(logger).toBeDefined();
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses provided correlation ID', () => {
    const { correlationId } = createCorrelatedLogger('test-worker', 'custom-id-123');
    expect(correlationId).toBe('custom-id-123');
  });
});
