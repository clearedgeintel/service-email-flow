import bcrypt from 'bcryptjs';

/**
 * Bcrypt cost factor. 12 is the modern default — slow enough to resist
 * brute-force against leaked hashes, fast enough that login latency stays
 * sub-200ms on Railway's standard CPU.
 */
const ROUNDS = 12;

/** Minimum password length enforced by the UI / admin-creation API. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Validate password strength. Throws on failure. Use BEFORE hashing in
 * any path that creates a new credential via the UI or API (POST /users,
 * PATCH /users/[id] with password change).
 *
 * The bootstrap path (legacy ADMIN_PASSWORD seeding the first user) does
 * NOT call this — that path migrates an already-accepted credential into
 * the new table, so we don't gate on length.
 */
export function validatePasswordStrength(plaintext: string): void {
  if (!plaintext || plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

/**
 * Hash a plaintext password for storage in users.password_hash. Accepts
 * any non-empty string. Callers that create new credentials should call
 * validatePasswordStrength() first.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext) {
    throw new Error('Password cannot be empty');
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
