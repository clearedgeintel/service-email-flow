import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password';

describe('hashPassword', () => {
  it('produces a bcrypt hash that verifies the original password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$2[abxy]\$/); // bcrypt prefix
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects empty passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });

  it('accepts short passwords (bootstrap path migrates legacy creds)', async () => {
    // The strength check lives in validatePasswordStrength, not hashPassword,
    // so legacy ADMIN_PASSWORD values shorter than 8 chars can still be
    // hashed and migrated into the users table without forcing a reset.
    const hash = await hashPassword('abc');
    expect(await verifyPassword('abc', hash)).toBe(true);
  });

  it('produces a different hash on every call (salt)', async () => {
    const a = await hashPassword('same-password-12345');
    const b = await hashPassword('same-password-12345');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-12345', a)).toBe(true);
    expect(await verifyPassword('same-password-12345', b)).toBe(true);
  });
});

describe('validatePasswordStrength', () => {
  it('accepts passwords ≥ 8 characters', () => {
    expect(() => validatePasswordStrength('12345678')).not.toThrow();
    expect(() => validatePasswordStrength('a-much-longer-password')).not.toThrow();
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(() => validatePasswordStrength('short')).toThrow(/8 characters/);
    expect(() => validatePasswordStrength('1234567')).toThrow(/8 characters/);
  });

  it('rejects empty input', () => {
    expect(() => validatePasswordStrength('')).toThrow();
  });
});

describe('verifyPassword', () => {
  it('returns false on wrong password', async () => {
    const hash = await hashPassword('one-password');
    expect(await verifyPassword('different-password', hash)).toBe(false);
  });

  it('returns false on malformed hash (does not throw)', async () => {
    expect(await verifyPassword('any', 'not-a-real-hash')).toBe(false);
  });

  it('returns false when either input is empty', async () => {
    expect(await verifyPassword('', 'whatever')).toBe(false);
    expect(await verifyPassword('whatever', '')).toBe(false);
  });
});
