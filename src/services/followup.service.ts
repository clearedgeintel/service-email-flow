import { getSupabase } from '@/lib/supabase';
import { getGmail } from '@/lib/gmail';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';
import { logCaseEvent } from './case-event.service';
import { EventType } from '@/types/events';

const log = createChildLogger('followup');

/** Find all cases eligible for follow-up right now */
export async function findEligibleCases(): Promise<number[]> {
  const supabase = getSupabase();

  const [delay1Hours, delay2Hours, maxFollowups] = await Promise.all([
    getConfig<number>('followup_delay_1_hours', 4),
    getConfig<number>('followup_delay_2_hours', 24),
    getConfig<number>('max_followups', 2),
  ]);

  // Query cases that need follow-up
  const { data, error } = await supabase
    .from('email_cases')
    .select('id, followup_count, customer_reply_at, last_followup_at')
    .eq('status', 'RESPONDED_PENDING_BOOKING')
    .eq('customer_reply_sent', true)
    .lt('followup_count', maxFollowups)
    .order('received_at', { ascending: true })
    .limit(10);

  if (error || !data) {
    log.error({ error }, 'Failed to query eligible follow-up cases');
    return [];
  }

  const now = Date.now();
  const eligible: number[] = [];

  for (const row of data) {
    const count = row.followup_count || 0;
    const delayHours = count === 0 ? delay1Hours : delay2Hours;
    const delayMs = delayHours * 60 * 60 * 1000;

    // Reference time: last_followup_at if we've already followed up, else customer_reply_at
    const refTime = row.last_followup_at || row.customer_reply_at;
    if (!refTime) continue;

    const refMs = new Date(refTime).getTime();
    if (now - refMs >= delayMs) {
      eligible.push(row.id);
    }
  }

  return eligible;
}

/** Send a follow-up email for a single case */
export async function sendFollowup(caseId: number): Promise<void> {
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (fetchError || !row) {
    throw new Error(`Case #${caseId} not found: ${fetchError?.message}`);
  }

  const customerEmail = row.customer_email || row.from_email;
  if (!customerEmail || customerEmail === 'unknown') {
    log.warn({ caseId }, 'No customer email — cannot send follow-up');
    return;
  }

  const [businessName, businessPhone] = await Promise.all([
    getConfig<string>('business_name', 'ProFix Electric & Plumbing'),
    getConfig<string>('business_phone', '(555) 123-4567'),
  ]);

  const isFirst = row.followup_count === 0;

  // Select cal.com link
  let calcomUrl: string;
  if (row.intent === 'SALES_INQUIRY' || row.intent === 'GENERAL_QUESTION') {
    calcomUrl = await getConfig<string>('calcom_estimate_url', 'https://cal.com/profix/free-estimate');
  } else if (row.intent === 'EMERGENCY') {
    calcomUrl = await getConfig<string>('calcom_emergency_url', 'https://cal.com/profix/emergency');
  } else {
    calcomUrl = await getConfig<string>('calcom_service_url', 'https://cal.com/profix/service-call');
  }

  let emailSubject: string;
  let emailBody: string;

  if (isFirst) {
    emailSubject = `Following up on your ${row.trade || 'service'} request — ${businessName}`;
    emailBody = `Hi ${row.customer_name || 'there'},

Just checking in! We received your request about ${(row.problem_summary || 'your service need').substring(0, 100)} and wanted to make sure you were able to book an appointment.

You can schedule at your convenience here:
${calcomUrl}

Or if you'd prefer, give us a call at ${businessPhone} and we'll get you set up right away.

Looking forward to helping!

—
${businessName}
${businessPhone}`;
  } else {
    emailSubject = `One more follow-up — ${businessName}`;
    emailBody = `Hi ${row.customer_name || 'there'},

We wanted to follow up one more time on your ${row.trade || 'service'} request. We'd love to help!

Book here: ${calcomUrl}
Or call us: ${businessPhone}

If you've already resolved the issue or no longer need service, no worries at all — just let us know and we'll close out your request.

Best,
${businessName}
${businessPhone}`;
  }

  // Send email
  const gmail = getGmail();
  const sendAs = process.env.GMAIL_SEND_AS || '';

  const rawMessage = buildRawTextEmail({ to: customerEmail, from: sendAs, subject: emailSubject, text: emailBody });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: rawMessage } });

  // Send SMS if phone available
  if (row.customer_phone) {
    await sendFollowupSms(row, businessName, businessPhone, calcomUrl);
  }

  // Update case
  const { error: updateError } = await supabase
    .from('email_cases')
    .update({
      followup_count: (row.followup_count || 0) + 1,
      last_followup_at: new Date().toISOString(),
      notes: (row.notes || '') + ` | Follow-up #${(row.followup_count || 0) + 1} sent`,
    })
    .eq('id', caseId);

  if (updateError) {
    log.error({ caseId, error: updateError }, 'Failed to update follow-up count');
  }

  await logCaseEvent({
    caseId,
    eventType: EventType.FOLLOWUP_SENT,
    summary: `Follow-up #${(row.followup_count || 0) + 1} sent to ${maskEmail(customerEmail)}`,
    metadata: { followup_number: (row.followup_count || 0) + 1, has_sms: !!row.customer_phone },
  });

  log.info({ caseId, followup: (row.followup_count || 0) + 1 }, 'Follow-up sent');
}

/** Escalate cases that have exhausted follow-ups to NEEDS_MANUAL_CALL */
export async function escalateMaxAttempts(): Promise<number> {
  const supabase = getSupabase();
  const maxFollowups = await getConfig<number>('max_followups', 2);

  const { data, error } = await supabase
    .from('email_cases')
    .select('id, customer_name, customer_phone, trade, problem_summary')
    .eq('status', 'RESPONDED_PENDING_BOOKING')
    .eq('customer_reply_sent', true)
    .gte('followup_count', maxFollowups);

  if (error || !data || data.length === 0) {
    return 0;
  }

  const ownerEmail = await getConfig<string>('owner_email', '');

  for (const row of data) {
    // Update status
    await supabase
      .from('email_cases')
      .update({
        status: 'NEEDS_MANUAL_CALL',
        notes: (row as any).notes + ' | Max follow-ups reached — route to manual call list', // eslint-disable-line @typescript-eslint/no-explicit-any
      })
      .eq('id', row.id);

    await logCaseEvent({
      caseId: row.id,
      eventType: EventType.ESCALATED,
      summary: `Max follow-ups reached — escalated to NEEDS_MANUAL_CALL`,
    });

    // Notify owner
    if (ownerEmail) {
      try {
        const gmail = getGmail();
        const sendAs = process.env.GMAIL_SEND_AS || '';
        const subject = `Manual call needed: ${row.customer_name || 'Customer'} (${row.trade || 'service'}) — Case #${row.id}`;
        const body = `Case #${row.id} has not booked after ${maxFollowups} follow-up attempts.

Customer: ${row.customer_name || 'Unknown'}
Phone: ${row.customer_phone || 'Not available'}
Trade: ${row.trade || 'Unknown'}
Issue: ${row.problem_summary || 'See case details'}

Please call the customer manually or mark as closed.`;

        const rawMessage = buildRawTextEmail({ to: ownerEmail, from: sendAs, subject, text: body });
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: rawMessage } });
      } catch (err) {
        log.error({ caseId: row.id, err }, 'Failed to send manual call notification');
      }
    }

    log.info({ caseId: row.id }, 'Case escalated to NEEDS_MANUAL_CALL');
  }

  return data.length;
}

async function sendFollowupSms(
  row: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  businessName: string,
  businessPhone: string,
  calcomUrl: string,
): Promise<void> {
  try {
    const { getTwilio } = await import('@/lib/twilio');
    const twilioFrom = await getConfig<string>('twilio_from_number', '');
    if (!twilioFrom) return;

    const twilio = getTwilio();
    let sms = `Hi ${row.customer_name || 'there'}! This is ${businessName}. Following up on your ${row.trade || 'service'} request. Book here: ${calcomUrl} or call ${businessPhone}`;
    sms = sms.substring(0, 320);

    await twilio.messages.create({
      body: sms,
      from: twilioFrom,
      to: row.customer_phone,
    });
  } catch (err) {
    log.warn({ caseId: row.id, err }, 'Follow-up SMS failed (non-critical)');
  }
}

function buildRawTextEmail(params: { to: string; from: string; subject: string; text: string }): string {
  const raw = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    '',
    params.text,
  ].join('\r\n');

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function maskEmail(email: string): string {
  if (!email) return 'n/a';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return user.substring(0, 2) + '***@' + domain;
}
