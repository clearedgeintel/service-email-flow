import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('retention');

/** Delete expired admin sessions from the database */
export async function cleanupExpiredSessions(): Promise<number> {
  const supabase = getSupabase();
  const cleanupHours = await getConfig<number>('session_cleanup_hours', 48);
  const cutoff = new Date(Date.now() - cleanupHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('admin_sessions')
    .delete()
    .lt('expires_at', cutoff)
    .select('id');

  if (error) {
    log.error({ error }, 'Failed to cleanup expired sessions');
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    log.info({ count, cutoff }, 'Cleaned up expired sessions');
  }
  return count;
}

/** Archive closed cases older than the retention period */
export async function archiveOldCases(): Promise<number> {
  const supabase = getSupabase();
  const retentionDays = await getConfig<number>('retention_days', 365);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('email_cases')
    .update({ archived_at: new Date().toISOString() })
    .eq('status', 'CLOSED')
    .is('archived_at', null)
    .lt('updated_at', cutoff)
    .select('id');

  if (error) {
    log.error({ error }, 'Failed to archive old cases');
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    log.info({ count, retentionDays, cutoff }, 'Archived old closed cases');
  }
  return count;
}

/** Export all data associated with a customer email (GDPR data export) */
export async function exportCustomerData(email: string): Promise<{
  cases: unknown[];
  events: unknown[];
}> {
  const supabase = getSupabase();
  const normalizedEmail = email.toLowerCase().trim();

  // Find all cases for this email
  const { data: cases, error: casesError } = await supabase
    .from('email_cases')
    .select('*')
    .or(`customer_email.eq.${normalizedEmail},from_email.eq.${normalizedEmail}`)
    .order('received_at', { ascending: false });

  if (casesError) {
    log.error({ error: casesError, email: normalizedEmail }, 'Failed to export customer cases');
    throw new Error(`Export failed: ${casesError.message}`);
  }

  const caseIds = (cases || []).map((c: Record<string, unknown>) => c.id);

  // Get all events for those cases
  let events: unknown[] = [];
  if (caseIds.length > 0) {
    const { data: eventData, error: eventsError } = await supabase
      .from('case_events')
      .select('*')
      .in('case_id', caseIds)
      .order('created_at', { ascending: false });

    if (eventsError) {
      log.error({ error: eventsError }, 'Failed to export customer events');
    }
    events = eventData || [];
  }

  return { cases: cases || [], events };
}

/** Purge all PII for a customer email (GDPR right to be forgotten) */
export async function forgetCustomer(email: string): Promise<{
  casesAnonymized: number;
  eventsDeleted: number;
}> {
  const supabase = getSupabase();
  const normalizedEmail = email.toLowerCase().trim();

  // Find all cases for this email
  const { data: cases } = await supabase
    .from('email_cases')
    .select('id')
    .or(`customer_email.eq.${normalizedEmail},from_email.eq.${normalizedEmail}`);

  const caseIds = (cases || []).map((c: Record<string, unknown>) => c.id as number);

  if (caseIds.length === 0) {
    return { casesAnonymized: 0, eventsDeleted: 0 };
  }

  // Anonymize PII in cases (keep the case structure for business analytics)
  const { error: updateError } = await supabase
    .from('email_cases')
    .update({
      from_email: 'redacted@redacted.com',
      from_name: '[REDACTED]',
      customer_email: 'redacted@redacted.com',
      customer_name: '[REDACTED]',
      customer_phone: null,
      service_address: null,
      preferred_times: null,
      body_raw: '[REDACTED — GDPR]',
      body_cleaned: '[REDACTED — GDPR]',
      snippet: '[REDACTED]',
      notes: '[PII redacted per GDPR request]',
    })
    .in('id', caseIds);

  if (updateError) {
    log.error({ error: updateError }, 'Failed to anonymize customer cases');
    throw new Error(`Anonymization failed: ${updateError.message}`);
  }

  // Delete associated events (they may contain PII in summary/metadata)
  const { data: deletedEvents, error: deleteError } = await supabase
    .from('case_events')
    .delete()
    .in('case_id', caseIds)
    .select('id');

  if (deleteError) {
    log.error({ error: deleteError }, 'Failed to delete customer events');
  }

  const eventsDeleted = deletedEvents?.length || 0;

  log.info(
    { email: normalizedEmail, casesAnonymized: caseIds.length, eventsDeleted },
    'Customer data forgotten (GDPR)',
  );

  return { casesAnonymized: caseIds.length, eventsDeleted };
}
