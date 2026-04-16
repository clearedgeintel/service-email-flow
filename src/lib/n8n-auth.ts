import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from './supabase';
import { invalidateConfigCache } from './config';
import { createChildLogger } from './logger';

const log = createChildLogger('n8n-auth');

const KEY = 'n8n_callback_api_key';

/**
 * Get the current n8n callback API key. If none has been set yet,
 * lazily generate one, persist to settings, and return it.
 * Reads directly from settings (bypassing config cache) so regenerate
 * is visible immediately.
 */
export async function getOrCreateN8nApiKey(): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', KEY)
    .single();

  const existing = data ? (data as { value: unknown }).value : null;
  if (typeof existing === 'string' && existing.length >= 32) {
    return existing;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  await supabase
    .from('settings')
    .upsert({ key: KEY, value: generated }, { onConflict: 'key' });
  invalidateConfigCache();
  log.info('Generated new n8n callback API key');
  return generated;
}

/** Regenerate the API key — invalidates any existing n8n workflows. */
export async function rotateN8nApiKey(): Promise<string> {
  const supabase = getSupabase();
  const generated = crypto.randomBytes(32).toString('hex');
  await supabase
    .from('settings')
    .upsert({ key: KEY, value: generated }, { onConflict: 'key' });
  invalidateConfigCache();
  log.info('Rotated n8n callback API key');
  return generated;
}

/**
 * Verify a `Authorization: Bearer <key>` header against the stored key.
 * Returns null on success, or a NextResponse 401 on failure.
 */
export async function requireN8nAuth(request: NextRequest): Promise<NextResponse | null> {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 });
  }

  const presented = match[1].trim();
  const actual = await getOrCreateN8nApiKey();

  // Constant-time compare
  if (presented.length !== actual.length) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  const ok = crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(actual));
  if (!ok) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  return null;
}
