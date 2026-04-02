import { logger } from './logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before trying again (half-open) */
  resetTimeout: number;
  /** Name for logging */
  name: string;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  successesSinceHalfOpen: number;
}

const circuits = new Map<string, CircuitBreakerState>();

function getState(name: string): CircuitBreakerState {
  if (!circuits.has(name)) {
    circuits.set(name, {
      state: 'CLOSED',
      failures: 0,
      lastFailureAt: 0,
      successesSinceHalfOpen: 0,
    });
  }
  return circuits.get(name)!;
}

/**
 * Execute a function with circuit breaker protection.
 * If the circuit is open, the fallback is called instead.
 * After resetTimeout, a single request is allowed through (half-open).
 */
export async function withCircuitBreaker<T>(
  options: CircuitBreakerOptions,
  fn: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<{ result: T; usedFallback: boolean }> {
  const cb = getState(options.name);
  const now = Date.now();

  // Check if circuit should transition from OPEN to HALF_OPEN
  if (cb.state === 'OPEN' && now - cb.lastFailureAt >= options.resetTimeout) {
    cb.state = 'HALF_OPEN';
    cb.successesSinceHalfOpen = 0;
    logger.info({ circuit: options.name }, 'Circuit breaker half-open — allowing test request');
  }

  // If circuit is open, use fallback
  if (cb.state === 'OPEN') {
    logger.warn({ circuit: options.name }, 'Circuit breaker open — using fallback');
    const result = await fallback();
    return { result, usedFallback: true };
  }

  // Try the primary function
  try {
    const result = await fn();

    // Success — reset or close circuit
    if (cb.state === 'HALF_OPEN') {
      cb.successesSinceHalfOpen++;
      if (cb.successesSinceHalfOpen >= 2) {
        cb.state = 'CLOSED';
        cb.failures = 0;
        logger.info({ circuit: options.name }, 'Circuit breaker closed — service recovered');
      }
    } else {
      cb.failures = 0;
    }

    return { result, usedFallback: false };
  } catch (err) {
    cb.failures++;
    cb.lastFailureAt = now;

    if (cb.failures >= options.failureThreshold) {
      cb.state = 'OPEN';
      logger.error(
        { circuit: options.name, failures: cb.failures },
        'Circuit breaker opened — too many failures',
      );
    }

    // In half-open state, any failure re-opens the circuit
    if (cb.state === 'HALF_OPEN') {
      cb.state = 'OPEN';
    }

    // Try fallback
    logger.warn({ circuit: options.name, err }, 'Primary failed — using fallback');
    const result = await fallback();
    return { result, usedFallback: true };
  }
}

/** Reset a circuit breaker (useful for testing) */
export function resetCircuitBreaker(name: string): void {
  circuits.delete(name);
}
