import { describe, it, expect } from 'vitest';
import { rateLimit } from './rate-limit';

describe('rateLimit', () => {
  it('allows requests under the limit', () => {
    const result = rateLimit('test-ip-1', 5, 60_000);
    expect(result).toBeNull();
  });

  it('returns 429 when limit exceeded', () => {
    const id = `test-ip-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      rateLimit(id, 3, 60_000);
    }
    const result = rateLimit(id, 3, 60_000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('accepts custom window and max settings', () => {
    const id = `custom-${Date.now()}`;
    const r1 = rateLimit(id, 1, 60_000);
    expect(r1).toBeNull();

    const r2 = rateLimit(id, 1, 60_000);
    expect(r2).not.toBeNull();
    expect(r2!.status).toBe(429);
  });
});
