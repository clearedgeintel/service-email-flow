import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withCircuitBreaker, resetCircuitBreaker } from './circuit-breaker';

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const opts = { name: 'test-circuit', failureThreshold: 2, resetTimeout: 100 };

beforeEach(() => {
  resetCircuitBreaker('test-circuit');
});

describe('withCircuitBreaker', () => {
  it('calls primary function when circuit is closed', async () => {
    const primary = vi.fn().mockResolvedValue('primary-result');
    const fallback = vi.fn().mockResolvedValue('fallback-result');

    const { result, usedFallback } = await withCircuitBreaker(opts, primary, fallback);

    expect(result).toBe('primary-result');
    expect(usedFallback).toBe(false);
    expect(primary).toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses fallback when primary fails', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('fail'));
    const fallback = vi.fn().mockResolvedValue('fallback-result');

    const { result, usedFallback } = await withCircuitBreaker(opts, primary, fallback);

    expect(result).toBe('fallback-result');
    expect(usedFallback).toBe(true);
  });

  it('opens circuit after threshold failures', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('fail'));
    const fallback = vi.fn().mockResolvedValue('fallback');

    // Fail twice to hit threshold (failureThreshold: 2)
    await withCircuitBreaker(opts, primary, fallback);
    await withCircuitBreaker(opts, primary, fallback);

    // Third call should not even try primary — circuit is open
    primary.mockClear();
    await withCircuitBreaker(opts, primary, fallback);

    expect(primary).not.toHaveBeenCalled();
  });

  it('transitions to half-open after resetTimeout', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('fail'));
    const fallback = vi.fn().mockResolvedValue('fallback');

    // Open the circuit
    await withCircuitBreaker(opts, primary, fallback);
    await withCircuitBreaker(opts, primary, fallback);

    // Wait for resetTimeout
    await new Promise((r) => setTimeout(r, 150));

    // Now primary should be tried again (half-open)
    primary.mockResolvedValue('recovered');
    const { result, usedFallback } = await withCircuitBreaker(opts, primary, fallback);

    expect(primary).toHaveBeenCalled();
    expect(result).toBe('recovered');
    expect(usedFallback).toBe(false);
  });

  it('re-opens circuit if half-open test fails', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('fail'));
    const fallback = vi.fn().mockResolvedValue('fallback');

    // Open circuit
    await withCircuitBreaker(opts, primary, fallback);
    await withCircuitBreaker(opts, primary, fallback);

    // Wait for half-open
    await new Promise((r) => setTimeout(r, 150));

    // Half-open test also fails
    primary.mockClear();
    await withCircuitBreaker(opts, primary, fallback);

    // Circuit should be open again — next call should skip primary
    primary.mockClear();
    await withCircuitBreaker(opts, primary, fallback);
    expect(primary).not.toHaveBeenCalled();
  });
});
