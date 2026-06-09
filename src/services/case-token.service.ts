import crypto from 'crypto';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('case-token');

/** Generate a URL-safe 22-char token (128 bits of entropy) */
export function generateCaseToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Get or create an access token for a case. Idempotent — returns the existing
 * unexpired token if one exists.
 */
export async function getOrCreateCaseToken(caseId: number): Promise<string | null> {
  const supabase = getSupabase();

  // Check for existing valid token
  const { data: existing } = await supabase
    .from('case_access_tokens')
    .select('token, expires_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const row = existing as { token: string; expires_at: string | null };
    if (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()) {
      return row.token;
    }
  }

  // Create new token
  const ttlDays = await getConfig<number>('portal_token_ttl_days', 180);
  const ttl = typeof ttlDays === 'number' ? ttlDays : parseInt(String(ttlDays), 10) || 180;
  const token = generateCaseToken();
  const expiresAt = ttl > 0
    ? new Date(Date.now() + ttl * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Phase 1 single-tenant: stamp the default tenant. PR2B + Phase 3 derive
  // from request context.
  const { getDefaultTenantId } = await import('@/lib/tenant');
  const tenantId = await getDefaultTenantId();

  const { error } = await supabase.from('case_access_tokens').insert({
    tenant_id: tenantId,
    token,
    case_id: caseId,
    expires_at: expiresAt,
  });

  if (error) {
    log.warn({ error, caseId }, 'Failed to create case access token');
    return null;
  }

  return token;
}

/** Build the public status URL for a given token using configured base URL */
export async function buildStatusUrl(token: string, requestOrigin?: string): Promise<string> {
  const configured = await getConfig<string>('portal_base_url', '');
  const base = configured || requestOrigin || '';
  if (!base) return `/status/${token}`;
  return `${base.replace(/\/$/, '')}/status/${token}`;
}

export interface PublicCaseData {
  case_short_id: string;                    // e.g. "#123" — friendlier than raw ID
  received_at: string;
  subject: string | null;
  customer_name: string | null;
  status: string;                            // public-friendly label, not raw enum
  status_description: string;                // human explanation of what's next
  intent: string | null;
  urgency_level: string | null;
  trade: string | null;
  problem_summary: string | null;
  reply_sent_at: string | null;
  tech_notified: boolean;
  booking: {
    status: string | null;                   // booked | cancelled | completed | null
    start_at: string | null;
    end_at: string | null;
  } | null;
  timeline: Array<{
    event: string;                           // human-readable event label
    at: string;
  }>;
}

/**
 * Look up a case by its public access token and return a sanitized view.
 * Returns null if token invalid or expired. Never returns PII beyond what
 * the customer already submitted.
 */
export async function getPublicCaseByToken(token: string): Promise<PublicCaseData | null> {
  const supabase = getSupabase();

  const { data: tokenRow } = await supabase
    .from('case_access_tokens')
    .select('case_id, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!tokenRow) return null;
  const tr = tokenRow as { case_id: number; expires_at: string | null };
  if (tr.expires_at && new Date(tr.expires_at).getTime() < Date.now()) return null;

  // Update last_viewed_at (fire-and-forget)
  supabase
    .from('case_access_tokens')
    .update({ last_viewed_at: new Date().toISOString() })
    .eq('token', token)
    .then(() => undefined);

  const { data: caseRow, error: caseErr } = await supabase
    .from('email_cases')
    .select(`
      id, received_at, subject, customer_name, status, intent, urgency_level,
      trade, problem_summary, customer_reply_sent, customer_reply_at,
      tech_notified, booking_status, booking_start_at, booking_end_at,
      archived_at
    `)
    .eq('id', tr.case_id)
    .single();

  if (caseErr || !caseRow) return null;
  const c = caseRow as Record<string, unknown>;

  // Don't show archived cases via public portal
  if (c.archived_at) return null;

  // Fetch a sanitized timeline (customer-safe events only, last 20)
  const { data: events } = await supabase
    .from('case_events')
    .select('event_type, summary, created_at')
    .eq('case_id', tr.case_id)
    .order('created_at', { ascending: false })
    .limit(20);

  const timeline = ((events || []) as Array<{
    event_type: string;
    summary: string | null;
    created_at: string;
  }>)
    .filter((e) => isCustomerVisibleEvent(e.event_type))
    .reverse()
    .map((e) => ({
      event: humanizeEvent(e.event_type),
      at: e.created_at,
    }));

  const status = c.status as string;
  return {
    case_short_id: `#${c.id}`,
    received_at: c.received_at as string,
    subject: (c.subject as string) || null,
    customer_name: (c.customer_name as string) || null,
    status: publicStatusLabel(status),
    status_description: publicStatusDescription(status, Boolean(c.booking_start_at)),
    intent: (c.intent as string) || null,
    urgency_level: (c.urgency_level as string) || null,
    trade: (c.trade as string) || null,
    problem_summary: (c.problem_summary as string) || null,
    reply_sent_at: (c.customer_reply_at as string) || null,
    tech_notified: Boolean(c.tech_notified),
    booking: c.booking_start_at
      ? {
          status: (c.booking_status as string) || null,
          start_at: (c.booking_start_at as string) || null,
          end_at: (c.booking_end_at as string) || null,
        }
      : null,
    timeline,
  };
}

/** Event types customers should see on the portal */
const CUSTOMER_VISIBLE_EVENTS = new Set([
  'RECEIVED',
  'CLASSIFIED',
  'ROUTED',
  'REPLY_SENT',
  'FOLLOWUP_SENT',
  'ESCALATED',
  'CLOSED',
  'STATUS_CHANGED',
]);

function isCustomerVisibleEvent(eventType: string): boolean {
  return CUSTOMER_VISIBLE_EVENTS.has(eventType);
}

function humanizeEvent(eventType: string): string {
  switch (eventType) {
    case 'RECEIVED': return 'Your message was received';
    case 'CLASSIFIED': return 'Our team reviewed your request';
    case 'ROUTED': return 'Routed to the right team';
    case 'REPLY_SENT': return 'We replied to you';
    case 'FOLLOWUP_SENT': return 'We sent a follow-up';
    case 'ESCALATED': return 'Escalated as urgent';
    case 'CLOSED': return 'Case closed';
    case 'STATUS_CHANGED': return 'Status updated';
    default: return eventType.replace(/_/g, ' ').toLowerCase();
  }
}

function publicStatusLabel(status: string): string {
  const map: Record<string, string> = {
    RECEIVED: 'Received',
    CLASSIFIED: 'In Review',
    RESPONDED_PENDING_BOOKING: 'Awaiting Your Booking',
    ESCALATED: 'Urgent — Contacting You',
    NEEDS_REVIEW: 'In Review',
    NEEDS_MANUAL_CALL: 'We Will Call You',
    CLOSED: 'Completed',
  };
  return map[status] || status;
}

function publicStatusDescription(status: string, hasBooking: boolean): string {
  if (hasBooking && status === 'RESPONDED_PENDING_BOOKING') {
    return 'Your appointment is scheduled. We look forward to seeing you.';
  }
  const map: Record<string, string> = {
    RECEIVED: 'We just received your message and will review it shortly.',
    CLASSIFIED: 'We are reviewing the details and will reply soon.',
    RESPONDED_PENDING_BOOKING: 'We sent you a reply with available times. Tap one to book.',
    ESCALATED: 'We are treating this as urgent. A technician will contact you shortly.',
    NEEDS_REVIEW: 'Our team is reviewing your request.',
    NEEDS_MANUAL_CALL: 'We tried following up — expect a phone call from us soon.',
    CLOSED: 'This case is complete. Thanks for choosing us!',
  };
  return map[status] || '';
}
