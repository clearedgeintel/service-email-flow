import { getSupabase } from './supabase';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Get a config value. Checks DB settings table first,
 * falls back to env var (key uppercased), falls back to default.
 * Caches in memory with 60s TTL.
 */
export async function getConfig<T = string>(key: string, defaultValue?: T): Promise<T> {
  // Check cache
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  // Check DB
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', key)
      .single();

    if (data?.value !== undefined && data.value !== null && data.value !== '') {
      const value = data.value as T;
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
  } catch {
    // DB unavailable — fall through to env
  }

  // Check env var (convert key like "business_name" to "BUSINESS_NAME")
  const envKey = key.toUpperCase();
  const envValue = process.env[envKey];
  if (envValue !== undefined) {
    // Try to parse as JSON for numeric/boolean values
    try {
      const parsed = JSON.parse(envValue) as T;
      cache.set(key, { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
      return parsed;
    } catch {
      cache.set(key, { value: envValue, expiresAt: Date.now() + CACHE_TTL_MS });
      return envValue as T;
    }
  }

  // Use default
  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Config key "${key}" not found in DB, env, or defaults`);
}

/** Bust the in-memory cache (call after settings PUT API). */
export function invalidateConfigCache(): void {
  cache.clear();
}
