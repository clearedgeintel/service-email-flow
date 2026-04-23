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
 * Defaults that mirror the migration 010 seed. Used to re-seed if the
 * email_templates table is empty (the migration ran but rows were lost,
 * or the migration was skipped in a fresh environment).
 *
 * Keep in sync with supabase/migrations/010_email_templates.sql.
 */
const DEFAULT_TEMPLATES: Array<Omit<EmailTemplate, 'updated_at'>> = [
  {
    key: 'composer_system_prompt',
    label: 'AI Reply — System Instructions',
    description: 'Instructions sent to Claude when generating customer replies. Affects tone, length, and content rules. The LLM still writes the actual reply creatively — this shapes how.',
    subject: null,
    body: `You are writing a customer reply email on behalf of "{{business_name}}".

RULES:
- Be polite, professional, warm, and concise.
- Start with a greeting using the customer's first name if available.
- Briefly summarize what you understood about their request (1-2 sentences).
- If there are things you need clarified, ask 1-3 SPECIFIC questions (not generic).
- If this is an EMERGENCY: lead with safety instructions FIRST.
- Keep it under 200 words (the HTML template handles formatting, signature, buttons).
- Return ONLY the email body paragraphs as plain text. NO subject line, NO signature, NO HTML, NO markdown.
- Separate paragraphs with a blank line.
- Do NOT include the booking link as a URL — just write a sentence like "Click the button below to book your appointment" or "Use the link below to schedule."
- Do NOT include the business name/phone sign-off — the template handles that.
- Be human and warm, not robotic.
- Never make promises about timing you can't keep.`,
    body_format: 'system_prompt',
    variables: ['business_name'],
  },
  {
    key: 'fallback_reply_emergency',
    label: 'Fallback Reply — Emergency',
    description: 'Used when the LLM is unavailable AND the case is an emergency. Customer-facing plain text. Wrapped by the branded HTML template.',
    subject: null,
    body: `Hi {{customer_name}},

Thank you for reaching out. We understand this is urgent and are treating it as a priority.

If you are in any immediate danger, please call 911 first. For gas leaks, leave the building immediately and do not use any light switches or electronics.

A technician from {{business_name}} will contact you within 15 minutes. You can also reach us directly at {{business_phone}}.

Click the button below to confirm your emergency appointment.`,
    body_format: 'text',
    variables: ['customer_name', 'business_name', 'business_phone'],
  },
  {
    key: 'fallback_reply_standard',
    label: 'Fallback Reply — Standard',
    description: 'Used when the LLM is unavailable for non-emergency cases. Plain text wrapped by the HTML template.',
    subject: null,
    body: `Hi {{customer_name}},

Thank you for contacting {{business_name}} about {{problem_summary}}. We've received your message and want to help.

To get started, click the button below to schedule a convenient time, or call us directly at {{business_phone}}.

We look forward to assisting you!`,
    body_format: 'text',
    variables: ['customer_name', 'business_name', 'business_phone', 'problem_summary'],
  },
  {
    key: 'followup_first',
    label: 'Follow-up #1 (after initial reply)',
    description: 'Sent to customers who received a reply but haven\'t booked within the first follow-up delay.',
    subject: 'Following up on your {{trade}} request — {{business_name}}',
    body: `Hi {{customer_name}},

Just checking in! We received your request about {{problem_summary}} and wanted to make sure you were able to book an appointment.

You can schedule at your convenience here:
{{calcom_url}}

Or if you'd prefer, give us a call at {{business_phone}} and we'll get you set up right away.

Looking forward to helping!

—
{{business_name}}
{{business_phone}}`,
    body_format: 'text',
    variables: ['customer_name', 'business_name', 'business_phone', 'trade', 'problem_summary', 'calcom_url'],
  },
  {
    key: 'followup_second',
    label: 'Follow-up #2 (last attempt)',
    description: 'Sent as the final follow-up before the case is escalated to manual call list.',
    subject: 'One more follow-up — {{business_name}}',
    body: `Hi {{customer_name}},

We wanted to follow up one more time on your {{trade}} request. We'd love to help!

Book here: {{calcom_url}}
Or call us: {{business_phone}}

If you've already resolved the issue or no longer need service, no worries at all — just let us know and we'll close out your request.

Best,
{{business_name}}
{{business_phone}}`,
    body_format: 'text',
    variables: ['customer_name', 'business_name', 'business_phone', 'trade', 'calcom_url'],
  },
];

/**
 * Upsert the default template set. ON CONFLICT DO NOTHING equivalent —
 * existing rows are preserved, only missing keys are inserted. Safe to
 * run repeatedly.
 */
export async function seedDefaultTemplates(): Promise<{ inserted: number; skipped: number }> {
  const supabase = getSupabase();

  // Fetch existing keys so we only insert the ones that are missing
  const { data: existing, error: selectError } = await supabase
    .from('email_templates')
    .select('key');

  // If the table itself doesn't exist yet (migration 010 never ran), give
  // a targeted error — the seed button can INSERT rows but not run DDL,
  // so it can't fix this by itself.
  if (selectError) {
    if (isMissingTableError(selectError)) {
      throw new Error(
        'The email_templates table does not exist yet. Run migration 010 in Supabase (SQL Editor → paste supabase/migrations/010_email_templates.sql → Run), then reload schema cache under Settings → API.',
      );
    }
    log.error({ error: selectError }, 'Failed to read email_templates');
    throw new Error(selectError.message);
  }

  const existingKeys = new Set(((existing || []) as Array<{ key: string }>).map((r) => r.key));
  const missing = DEFAULT_TEMPLATES.filter((t) => !existingKeys.has(t.key));
  if (missing.length === 0) {
    return { inserted: 0, skipped: DEFAULT_TEMPLATES.length };
  }

  const { error } = await supabase.from('email_templates').insert(missing);
  if (error) {
    if (isMissingTableError(error)) {
      throw new Error(
        'The email_templates table does not exist yet. Run migration 010 in Supabase.',
      );
    }
    log.error({ error }, 'Failed to seed default templates');
    throw new Error(error.message);
  }

  cache.clear();
  log.info({ inserted: missing.length }, 'Seeded default templates');
  return { inserted: missing.length, skipped: existingKeys.size };
}

/**
 * Supabase/PostgREST returns a recognizable message + code pair when a
 * queried table isn't in the schema cache. Detect it so we can give the
 * admin actionable guidance instead of the raw error.
 */
function isMissingTableError(err: { message?: string; code?: string; details?: string }): boolean {
  const msg = (err.message || '').toLowerCase();
  const details = (err.details || '').toLowerCase();
  // PGRST205 = "Could not find the table ... in the schema cache"
  // 42P01    = Postgres "undefined_table"
  return (
    err.code === 'PGRST205' ||
    err.code === '42P01' ||
    msg.includes('schema cache') ||
    msg.includes('relation') && msg.includes('does not exist') ||
    details.includes('schema cache')
  );
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
