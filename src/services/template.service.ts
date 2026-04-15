import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('templates');

export interface EmailTemplate {
  key: string;
  label: string;
  description: string | null;
  subject: string | null;
  body: string;
  body_format: 'text' | 'markdown' | 'system_prompt';
  variables: string[];
  updated_at: string;
}

// Cache templates in memory with 60s TTL. Invalidated on update via
// invalidateTemplateCache() from the API route.
interface CacheEntry {
  template: EmailTemplate;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/** Fetch a template by key. Returns null if not found. */
export async function getTemplate(key: string): Promise<EmailTemplate | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.template;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('key', key)
      .maybeSingle();

    if (error || !data) return null;

    const template = data as unknown as EmailTemplate;
    cache.set(key, { template, expiresAt: Date.now() + CACHE_TTL_MS });
    return template;
  } catch (err) {
    log.warn({ err, key }, 'Failed to load template');
    return null;
  }
}

/** List all templates (for the admin UI) */
export async function listTemplates(): Promise<EmailTemplate[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .order('key');

  if (error || !data) return [];
  return data as unknown as EmailTemplate[];
}

/** Update a template's subject and body (and bust cache) */
export async function updateTemplate(
  key: string,
  updates: { subject?: string | null; body?: string },
): Promise<EmailTemplate | null> {
  const supabase = getSupabase();
  const patch: Record<string, unknown> = {};
  if (updates.subject !== undefined) patch.subject = updates.subject;
  if (updates.body !== undefined) patch.body = updates.body;

  const { data, error } = await supabase
    .from('email_templates')
    .update(patch)
    .eq('key', key)
    .select()
    .single();

  if (error || !data) return null;

  cache.delete(key);
  return data as unknown as EmailTemplate;
}

/** Invalidate a single template in cache (or all if no key given) */
export function invalidateTemplateCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

/**
 * Render a template with {{variable}} substitution.
 * Unknown variables are left as-is (so they're visible in output — easier to debug).
 */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name) => {
    const value = vars[name];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

/**
 * Convenience: fetch a template and render it in one call.
 * Returns { subject, body } strings. If template missing, returns null.
 */
export async function renderTemplateByKey(
  key: string,
  vars: Record<string, string | number | null | undefined>,
): Promise<{ subject: string | null; body: string } | null> {
  const tpl = await getTemplate(key);
  if (!tpl) return null;
  return {
    subject: tpl.subject ? renderTemplate(tpl.subject, vars) : null,
    body: renderTemplate(tpl.body, vars),
  };
}
