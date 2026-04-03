import { getTwilio, getTwilioFromNumber } from '@/lib/twilio';
import { getGmail } from '@/lib/gmail';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { buildRawEmail } from '@/lib/email-builder';
import { createChildLogger } from '@/lib/logger';
import { logCaseEvent } from './case-event.service';
import { EventType } from '@/types/events';

const log = createChildLogger('notifier');

export async function notifyTech(caseId: number): Promise<void> {
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (fetchError || !row) {
    throw new Error(`Case #${caseId} not found: ${fetchError?.message}`);
  }

  if (row.tech_notified) {
    log.info({ caseId }, 'Tech already notified — skipping');
    return;
  }

  const [techEmail, techPhone, twilioFrom] = await Promise.all([
    getConfig<string>('tech_email', ''),
    getConfig<string>('tech_phone', ''),
    getConfig<string>('twilio_from_number', getTwilioFromNumber()),
  ]);

  if (!techEmail && !techPhone) {
    log.warn({ caseId }, 'No tech email or phone configured — cannot notify');
    return;
  }

  // Send SMS + email in parallel
  const results = await Promise.allSettled([
    techPhone ? sendTechSms(row, techPhone, twilioFrom) : Promise.resolve(null),
    techEmail ? sendTechEmail(row, techEmail) : Promise.resolve(null),
  ]);

  const smsResult = results[0];
  const emailResult = results[1];

  const smsDelivered = smsResult.status === 'fulfilled' && smsResult.value !== null;
  const emailDelivered = emailResult.status === 'fulfilled' && emailResult.value !== null;

  if (!smsDelivered && !emailDelivered) {
    const smsErr = smsResult.status === 'rejected' ? smsResult.reason?.message : 'not configured';
    const emailErr = emailResult.status === 'rejected' ? emailResult.reason?.message : 'not configured';
    throw new Error(`Both SMS and email failed for case #${caseId}. SMS: ${smsErr}, Email: ${emailErr}`);
  }

  const deliveryLog: string[] = [];
  if (smsDelivered) deliveryLog.push('SMS delivered');
  if (!smsDelivered && techPhone) deliveryLog.push('SMS FAILED');
  if (emailDelivered) deliveryLog.push('Email delivered');
  if (!emailDelivered && techEmail) deliveryLog.push('Email FAILED');

  // Update case
  const { error: updateError } = await supabase
    .from('email_cases')
    .update({
      tech_notified: true,
      tech_notified_at: new Date().toISOString(),
      notes: (row.notes || '') + ` | Tech notified: ${deliveryLog.join(', ')}`,
    })
    .eq('id', caseId);

  if (updateError) {
    log.error({ caseId, error: updateError }, 'Failed to update tech notification status');
  }

  await logCaseEvent({
    caseId,
    eventType: EventType.TECH_NOTIFIED,
    summary: `Tech notified: ${deliveryLog.join(', ')}`,
    metadata: {
      sms_delivered: smsDelivered,
      email_delivered: emailDelivered,
    },
  });

  log.info({ caseId, delivery: deliveryLog.join(', ') }, 'Tech notified');
}

async function sendTechSms(
  row: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  toPhone: string,
  fromPhone: string,
): Promise<string> {
  const urgencyEmoji: Record<string, string> = {
    EMERGENCY: '\u{1F6A8}',
    TODAY: '\u26A1',
    THIS_WEEK: '\u{1F4CB}',
    ROUTINE: '\u{1F4CB}',
  };

  const emoji = urgencyEmoji[row.urgency_level] || '\u{1F4CB}';
  const prefix = row.urgency_level === 'EMERGENCY' ? 'EMERGENCY ' : '';

  let sms = `${emoji} ${prefix}NEW ${(row.trade || 'SERVICE').toUpperCase()} JOB\n`;
  sms += `${row.customer_name || 'Unknown Customer'}\n`;
  if (row.customer_phone) sms += `Ph: ${row.customer_phone}\n`;
  if (row.service_address) sms += `Addr: ${row.service_address}\n`;
  sms += `Issue: ${(row.problem_summary || 'See email for details').substring(0, 100)}\n`;
  sms += `Urgency: ${row.urgency_level}`;
  if (row.preferred_times) sms += `\nPreferred: ${row.preferred_times.substring(0, 50)}`;
  sms += `\nCase #${row.id}`;

  const twilio = getTwilio();
  const message = await twilio.messages.create({
    body: sms.substring(0, 320),
    from: fromPhone,
    to: toPhone,
  });

  return message.sid;
}

async function sendTechEmail(
  row: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  toEmail: string,
): Promise<string> {
  const isEmergency = row.urgency_level === 'EMERGENCY';
  const divider = '='.repeat(45);
  const subDivider = '-'.repeat(35);

  const subject = isEmergency
    ? `EMERGENCY: ${row.trade || 'Service'} — ${row.customer_name || 'New Case'} (#${row.id})`
    : `New ${row.urgency_level} ${row.trade || 'service'} job — ${row.customer_name || 'New Case'} (#${row.id})`;

  const body = `
${divider}
  NEW SERVICE REQUEST ${isEmergency ? '*** EMERGENCY ***' : ''}
${divider}

Urgency:          ${row.urgency_level}${isEmergency ? ' — CONTACT CUSTOMER IMMEDIATELY' : ''}
Trade:            ${row.trade || 'Unknown'}
Service Type:     ${row.requested_service || 'Not specified'}

CUSTOMER INFO
${subDivider}
Name:             ${row.customer_name || 'Not provided'}
Email:            ${row.customer_email || row.from_email || 'Not provided'}
Phone:            ${row.customer_phone || 'Not provided'}
Address:          ${row.service_address || 'Not provided'}
Preferred Times:  ${row.preferred_times || 'Not specified'}

PROBLEM SUMMARY
${subDivider}
${row.problem_summary || 'No details provided.'}

CASE DETAILS
${subDivider}
Case ID:          #${row.id}
Intent:           ${row.intent}
Confidence:       ${row.confidence ? (row.confidence * 100).toFixed(0) + '%' : 'N/A'}
Attachments:      ${row.attachments_present ? 'Yes — check Gmail thread' : 'None'}

Original Subject: ${row.subject || '(none)'}
${row.gmail_thread_id ? `Gmail Thread:     https://mail.google.com/mail/#inbox/${row.gmail_thread_id}` : ''}

${divider}
This notification was generated by the ServiceFlow automation system.
`.trim();

  const gmail = getGmail();
  const sendAs = process.env.GMAIL_SEND_AS || '';

  const rawMessage = buildRawEmail({ to: toEmail, from: sendAs, subject, text: body });

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: rawMessage },
  });

  return result.data.id || '';
}
