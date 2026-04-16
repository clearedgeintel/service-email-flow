import twilio from 'twilio';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';
import { logCaseEvent } from './case-event.service';
import { emitWebhookEvent } from './webhook.service';
import { EventType } from '@/types/events';

const log = createChildLogger('sms');

export interface TwilioInboundParams {
  MessageSid: string;
  From: string;
  To: string;
  Body?: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaUrl1?: string;
  MediaUrl2?: string;
  MediaUrl3?: string;
  [key: string]: string | undefined;
}

export interface TwilioStatusParams {
  MessageSid: string;
  MessageStatus: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

/** Verify a Twilio webhook signature using the SDK helper. */
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false;
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch (err) {
    log.warn({ err }, 'twilio.validateRequest threw');
    return false;
  }
}

/**
 * Find an open case whose customer_phone matches the given number (tail
 * match on the last 10 digits — handles format differences like
 * "+15551234567" vs "(555) 123-4567").
 */
async function findCaseByPhone(phone: string): Promise<number | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const tail = digits.slice(-10);

  const { data } = await getSupabase()
    .from('email_cases')
    .select('id, customer_phone')
    .not('customer_phone', 'is', null)
    .not('status', 'in', '(CLOSED)')
    .order('received_at', { ascending: false })
    .limit(50);

  if (!data) return null;
  for (const row of data as Array<{ id: number; customer_phone: string }>) {
    const rowDigits = (row.customer_phone || '').replace(/\D/g, '');
    if (rowDigits === digits) return row.id;
    if (rowDigits.length >= 10 && rowDigits.slice(-10) === tail) return row.id;
  }
  return null;
}

/**
 * Create a new case from an inbound SMS when the sender has no existing
 * open case. The message body becomes the problem summary; intent is left
 * unclassified so the standard classifier can still pick it up later.
 */
async function createCaseFromSms(
  from: string,
  body: string,
  mediaCount: number,
): Promise<number | null> {
  const fakeGmailId = `sms:${from}:${Date.now()}`;
  const truncated = body.substring(0, 500);

  const { data, error } = await getSupabase()
    .from('email_cases')
    .insert({
      gmail_message_id: fakeGmailId,
      from_email: 'sms@cleardesk.internal',
      from_name: from,
      subject: `SMS from ${from}`,
      body_cleaned: body,
      body_raw: body,
      snippet: truncated.substring(0, 200),
      status: 'CLASSIFIED',
      intent: 'REPAIR_REQUEST',
      confidence: 0.6,
      customer_phone: from,
      problem_summary: truncated,
      urgency_level: 'ROUTINE',
      received_at: new Date().toISOString(),
      ...(mediaCount > 0 ? { notes: `[SMS included ${mediaCount} media attachment(s)]` } : {}),
    })
    .select('id')
    .single();

  if (error || !data) {
    log.error({ error, from }, 'Failed to create case from inbound SMS');
    return null;
  }

  const caseId = (data as { id: number }).id;
  await logCaseEvent({
    caseId,
    eventType: EventType.RECEIVED,
    actor: 'sms',
    summary: `Inbound SMS from ${from}`,
    metadata: { source: 'sms', from, media_count: mediaCount },
  });

  return caseId;
}

/**
 * Handle an inbound Twilio SMS webhook. Links to an existing open case by
 * phone tail-match; creates a new case if none found. Idempotent on
 * MessageSid.
 */
export async function processInboundSms(params: TwilioInboundParams): Promise<{
  handled: boolean;
  caseId: number | null;
  messageId: number | null;
}> {
  const sid = params.MessageSid;
  const from = params.From;
  const to = params.To;
  const body = params.Body || '';
  const numMedia = parseInt(params.NumMedia || '0', 10);

  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
  }

  const supabase = getSupabase();

  // Short-circuit on replay (Twilio can retry webhook delivery)
  const { data: existing } = await supabase
    .from('sms_messages')
    .select('id, case_id')
    .eq('twilio_sid', sid)
    .maybeSingle();

  if (existing) {
    return {
      handled: true,
      caseId: (existing as { case_id: number | null }).case_id,
      messageId: (existing as { id: number }).id,
    };
  }

  let caseId = await findCaseByPhone(from);
  if (!caseId) {
    caseId = await createCaseFromSms(from, body, numMedia);
  } else {
    await logCaseEvent({
      caseId,
      eventType: EventType.RECEIVED,
      actor: 'sms',
      summary: `Inbound SMS: ${body.substring(0, 160)}`,
      metadata: { source: 'sms', from, media_count: numMedia },
    });
  }

  const { data: inserted, error } = await supabase
    .from('sms_messages')
    .insert({
      twilio_sid: sid,
      case_id: caseId,
      direction: 'inbound',
      status: 'received',
      from_number: from,
      to_number: to,
      body,
      num_media: numMedia,
      media_urls: mediaUrls.length ? mediaUrls : null,
      received_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !inserted) {
    log.error({ error, sid }, 'Failed to persist inbound SMS row');
    return { handled: false, caseId, messageId: null };
  }

  const messageId = (inserted as { id: number }).id;

  emitWebhookEvent('sms.received', caseId, {
    twilio_sid: sid,
    from,
    to,
    body,
    media_urls: mediaUrls,
  });

  // Fire-and-forget auto-reply enqueue. Worker re-checks the flag before
  // spending a Claude call, so flipping the toggle off mid-flight is safe.
  if (caseId && body) {
    try {
      const { isSmsAutoReplyEnabled } = await import('./sms-reply.service');
      if (await isSmsAutoReplyEnabled()) {
        const { getQueue, QUEUE_NAMES } = await import('@/lib/queue');
        await getQueue(QUEUE_NAMES.SMS_AUTO_REPLY).add('reply', {
          caseId,
          inboundBody: body,
        });
      }
    } catch (err) {
      // Queue may be unavailable in test/dev — don't break the webhook
      log.warn({ err, caseId }, 'Failed to enqueue SMS auto-reply');
    }
  }

  log.info({ sid, caseId, messageId }, 'Inbound SMS processed');
  return { handled: true, caseId, messageId };
}

/**
 * Update the status of an existing outbound SMS row from a Twilio delivery
 * receipt webhook (sent/delivered/failed).
 */
export async function processStatusCallback(params: TwilioStatusParams): Promise<void> {
  const sid = params.MessageSid;
  const status = params.MessageStatus;

  const updates: Record<string, unknown> = { status };
  if (status === 'delivered') updates.delivered_at = new Date().toISOString();
  if (status === 'sent') updates.sent_at = new Date().toISOString();
  if (params.ErrorCode) updates.error_code = params.ErrorCode;
  if (params.ErrorMessage) updates.error_message = params.ErrorMessage;

  const { error } = await getSupabase()
    .from('sms_messages')
    .update(updates)
    .eq('twilio_sid', sid);

  if (error) {
    log.warn({ error, sid }, 'Failed to update SMS status');
  }
}

/** Send an outbound SMS via Twilio and persist a row linked to the case. */
export async function sendOutboundSms(params: {
  caseId: number;
  toNumber: string;
  body: string;
  actor?: string;
}): Promise<{ messageId: number; twilioSid: string }> {
  const [accountSid, authToken, fromNumber] = await Promise.all([
    getConfig<string>('twilio_account_sid', ''),
    getConfig<string>('twilio_auth_token', ''),
    getConfig<string>('twilio_from_number', ''),
  ]);

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured.');
  }
  if (!fromNumber) {
    throw new Error('No outbound SMS number configured (twilio_from_number).');
  }

  const client = twilio(accountSid, authToken);
  const msg = await client.messages.create({
    from: fromNumber,
    to: params.toNumber,
    body: params.body,
  });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sms_messages')
    .insert({
      twilio_sid: msg.sid,
      case_id: params.caseId,
      direction: 'outbound',
      status: msg.status || 'queued',
      from_number: fromNumber,
      to_number: params.toNumber,
      body: params.body,
      sent_at: new Date().toISOString(),
      metadata: { actor: params.actor || 'admin' },
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`SMS sent via Twilio but failed to persist row: ${error?.message}`);
  }

  const messageId = (data as { id: number }).id;

  await logCaseEvent({
    caseId: params.caseId,
    eventType: EventType.MANUAL_ACTION,
    actor: params.actor || 'admin',
    summary: `Outbound SMS: ${params.body.substring(0, 160)}`,
    metadata: { twilio_sid: msg.sid, to: params.toNumber },
  });

  emitWebhookEvent('sms.sent', params.caseId, {
    twilio_sid: msg.sid,
    to: params.toNumber,
    body: params.body,
  });

  return { messageId, twilioSid: msg.sid };
}

export async function isTwilioEnabled(): Promise<boolean> {
  const raw = await getConfig<unknown>('twilio_enabled', false);
  return raw === true || raw === 'true';
}

export async function getTwilioAuthToken(): Promise<string> {
  const fromSettings = await getConfig<string>('twilio_auth_token', '');
  if (fromSettings) return fromSettings;
  return process.env.TWILIO_AUTH_TOKEN || '';
}
