import bcrypt from 'bcryptjs';

/**
 * Bcrypt cost factor. 12 is the modern default — slow enough to resist
 * brute-force against leaked hashes, fast enough that login latency stays
 * sub-200ms on Railway's standard CPU.
 */
const ROUNDS = 12;

/** Hash a plaintext password for storage in users.password_hash. */
export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return bcrypt.hash(plaintext, ROUNDS);
}

/** Verify a plaintext password against a stored hash. Returns false on
 *  any error (malformed hash, mismatched, etc.) — never throws. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
