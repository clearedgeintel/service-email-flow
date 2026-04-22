import { getAnthropic, getModel } from '@/lib/anthropic';
import { getSupabase } from '@/lib/supabase';
import { getGmail } from '@/lib/gmail';
import { getConfig } from '@/lib/config';
import { buildHtmlEmail, buildPricingTableHtml } from '@/lib/email-template';
import { buildRawEmail } from '@/lib/email-builder';
import { createChildLogger } from '@/lib/logger';
import { withCircuitBreaker } from '@/lib/circuit-breaker';
import { logCaseEvent } from './case-event.service';
import { lookupPricing, formatPricingForPrompt } from './pricing.service';
import { EventType } from '@/types/events';

const log = createChildLogger('composer');

export interface ComposeOptions {
  /** Force-refresh Cal.com slots (skip the 5-min in-memory cache).
   *  Used for admin-triggered resends so a stale empty cached result
   *  from a misconfigured initial run doesn't stick. */
  bypassSlotCache?: boolean;
}

export async function composeAndSendReply(caseId: number, options: ComposeOptions = {}): Promise<void> {
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (fetchError || !row) {
    throw new Error(`Case #${caseId} not found: ${fetchError?.message}`);
  }

  if (row.customer_reply_sent) {
    log.info({ caseId }, 'Reply already sent — skipping');
    return;
  }

  const customerEmail = row.customer_email || row.from_email;
  if (!customerEmail || customerEmail === 'unknown') {
    log.warn({ caseId }, 'No customer email — cannot send reply');
    return;
  }

  // Load business config
  const [businessName, businessPhone, businessUrl, businessLocation] = await Promise.all([
    getConfig<string>('business_name', 'ProFix Electric & Plumbing'),
    getConfig<string>('business_phone', '(555) 123-4567'),
    getConfig<string>('business_url', 'https://profixservice.com'),
    getConfig<string>('business_location', 'Fort Worth, TX'),
  ]);

  // Pricing lookup
  const searchText = [row.problem_summary, row.requested_service, row.subject, row.body_cleaned]
    .filter(Boolean)
    .join(' ');

  const pricingItems = await lookupPricing(searchText, row.trade);
  const hasPricing = pricingItems.length > 0;

  // Select cal.com URL
  const isEmergency = row.status === 'ESCALATED' || row.urgency_level === 'EMERGENCY';
  const { calcomUrl, calcomLabel } = await selectCalcomLink(row.intent, row.urgency_level, isEmergency);

  // Smart scheduling: fetch 3-5 available Cal.com slots (if configured).
  const slotOptions = await fetchSlotsForCase(row.intent, isEmergency, calcomUrl, row.id, options.bypassSlotCache);

  // Generate customer portal status token for "Check your case status" link
  const { getOrCreateCaseToken, buildStatusUrl } = await import('./case-token.service');
  const portalToken = await getOrCreateCaseToken(caseId);
  const statusUrl = portalToken ? await buildStatusUrl(portalToken) : '';

  // Build LLM prompt with circuit breaker fallback
  const replyParams = {
    row,
    businessName,
    businessPhone,
    calcomUrl,
    calcomLabel,
    pricingInfo: hasPricing ? formatPricingForPrompt(pricingItems) : null,
    isEmergency,
    slotOptions,
  };

  const { result: replyText, usedFallback } = await withCircuitBreaker(
    { name: 'openai-composer', failureThreshold: 3, resetTimeout: 60_000 },
    () => generateReplyText(replyParams),
    () => generateFallbackReply(replyParams),
  );

  if (usedFallback) {
    log.warn({ caseId }, 'Used template fallback — OpenAI unavailable');
  }

  // Build paragraphs into HTML
  const paragraphs = replyText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;line-height:1.6;color:#333333;font-size:15px;">${p.replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

  const pricingHtml = hasPricing ? buildPricingTableHtml(pricingItems) : undefined;

  const htmlEmail = buildHtmlEmail({
    bodyHtml,
    businessName,
    businessPhone,
    businessUrl,
    businessLocation,
    ctaUrl: calcomUrl,
    ctaLabel: calcomLabel,
    isEmergency,
    pricingHtml,
    slotOptions,
    statusUrl,
  });

  // Idempotency check: re-verify reply hasn't been sent by a concurrent job
  const { data: recheck } = await supabase
    .from('email_cases')
    .select('customer_reply_sent')
    .eq('id', caseId)
    .single();

  if (recheck?.customer_reply_sent) {
    log.info({ caseId }, 'Reply already sent (concurrent check) — skipping');
    return;
  }

  // Determine send mode: auto-send emergencies, otherwise check setting.
  // Coerce defensively — the settings JSONB column may store 'true'/'false' as
  // strings from the UI toggle, which are both truthy in JS.
  const autoReplyRaw = await getConfig<unknown>('auto_reply', false);
  const autoReply = autoReplyRaw === true || autoReplyRaw === 'true';
  const shouldSendNow = isEmergency || autoReply;

  const gmail = getGmail();
  const sendAs = process.env.GMAIL_SEND_AS || '';

  const rawMessage = buildRawEmail({
    to: customerEmail,
    from: sendAs,
    subject: `Re: ${row.subject || '(no subject)'}`,
    html: htmlEmail,
    text: replyText,
  });

  let sendResult: { data: { id?: string | null } };

  if (shouldSendNow) {
    // Send immediately
    sendResult = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawMessage },
    });
    log.info({ caseId, mode: 'sent' }, 'Reply sent immediately');
  } else {
    // Save as draft for review
    sendResult = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw: rawMessage, threadId: row.gmail_thread_id || undefined },
      },
    });
    log.info({ caseId, mode: 'draft' }, 'Reply saved as draft for review');
  }

  // Update case
  const draftReply = shouldSendNow
    ? null
    : {
        subject: `Re: ${row.subject || '(no subject)'}`,
        body_text: replyText,
        body_html: htmlEmail,
        to: customerEmail,
        created_at: new Date().toISOString(),
        used_fallback: usedFallback,
      };

  const { error: updateError } = await supabase
    .from('email_cases')
    .update({
      customer_reply_sent: shouldSendNow,
      customer_reply_at: shouldSendNow ? new Date().toISOString() : null,
      status: shouldSendNow ? undefined : 'NEEDS_REVIEW',
      draft_reply: draftReply,
      draft_gmail_id: shouldSendNow ? null : sendResult.data.id,
      notes: shouldSendNow
        ? row.notes
        : (row.notes || '') + ' | Draft reply saved — pending admin review',
    })
    .eq('id', caseId);

  if (updateError) {
    log.error({ caseId, error: updateError }, 'Failed to update reply status');
  }

  // Sync Gmail label based on new status
  const newStatus = shouldSendNow ? (row.status || 'RESPONDED_PENDING_BOOKING') : 'NEEDS_REVIEW';
  const { syncMessageLabel } = await import('@/lib/gmail-labels');
  await syncMessageLabel(row.gmail_message_id, newStatus);

  // Log event
  await logCaseEvent({
    caseId,
    eventType: EventType.REPLY_SENT,
    summary: shouldSendNow
      ? `Reply sent to ${maskEmail(customerEmail)} — ${isEmergency ? 'EMERGENCY' : row.urgency_level}`
      : `Draft reply saved for ${maskEmail(customerEmail)} — pending review`,
    metadata: {
      gmail_id: sendResult.data.id,
      mode: shouldSendNow ? 'sent' : 'draft',
      has_pricing: hasPricing,
      calcom_url: calcomUrl,
      is_emergency: isEmergency,
      used_fallback: usedFallback,
    },
  });

  // Only emit case.replied when actually sent (not for drafts awaiting approval)
  if (shouldSendNow) {
    const { emitWebhookEvent } = await import('./webhook.service');
    emitWebhookEvent('case.replied', caseId, {
      to: customerEmail,
      is_emergency: isEmergency,
      has_pricing: hasPricing,
      used_fallback: usedFallback,
      slot_options_offered: slotOptions?.length || 0,
    });
  }
}

async function selectCalcomLink(
  intent: string | null,
  urgencyLevel: string | null,
  isEmergency: boolean,
): Promise<{ calcomUrl: string; calcomLabel: string }> {
  if (isEmergency) {
    const url = await getConfig<string>('calcom_emergency_url', 'https://cal.com/profix/emergency');
    return { calcomUrl: url, calcomLabel: 'Emergency Priority Slot' };
  }

  if (intent === 'REPAIR_REQUEST') {
    const url = await getConfig<string>('calcom_service_url', 'https://cal.com/profix/service-call');
    const label = urgencyLevel === 'TODAY' ? 'Priority Service Call (Same Day)' : 'Standard Service Call';
    return { calcomUrl: url, calcomLabel: label };
  }

  const url = await getConfig<string>('calcom_estimate_url', 'https://cal.com/profix/free-estimate');
  return { calcomUrl: url, calcomLabel: 'Free Estimate / Consultation' };
}

/**
 * Fetch pre-filled Cal.com slot options for injection into the reply email.
 * Picks the correct event type ID based on intent/emergency and returns [] if
 * smart scheduling is disabled or any call fails (graceful degradation).
 */
async function fetchSlotsForCase(
  intent: string | null,
  isEmergency: boolean,
  calcomUrl: string,
  caseId?: number,
  bypassCache?: boolean,
) {
  const enabledRaw = await getConfig<unknown>('smart_scheduling_enabled', false);
  const enabled = enabledRaw === true || enabledRaw === 'true';
  if (!enabled) {
    log.info({ caseId, reason: 'smart_scheduling_disabled' }, 'No slots offered — toggle is off');
    return [];
  }

  const apiKey = await getConfig<string>('calcom_api_key', '');
  if (!apiKey) {
    log.warn({ caseId, reason: 'no_calcom_api_key' }, 'No slots offered — calcom_api_key is empty');
    return [];
  }

  // Pick the right event type ID mirroring selectCalcomLink's routing
  let eventTypeId = 0;
  let eventTypeSource: string;
  if (isEmergency) {
    eventTypeId = await getConfig<number>('calcom_event_type_emergency', 0);
    eventTypeSource = 'calcom_event_type_emergency';
  } else if (intent === 'REPAIR_REQUEST') {
    eventTypeId = await getConfig<number>('calcom_event_type_service', 0);
    eventTypeSource = 'calcom_event_type_service';
  } else {
    eventTypeId = await getConfig<number>('calcom_event_type_estimate', 0);
    eventTypeSource = 'calcom_event_type_estimate';
  }

  // Coerce string values from JSONB storage
  const eventTypeIdNum = typeof eventTypeId === 'number' ? eventTypeId : parseInt(String(eventTypeId), 10);
  if (!eventTypeIdNum || isNaN(eventTypeIdNum)) {
    log.warn(
      { caseId, intent, isEmergency, eventTypeSource, configured: eventTypeId },
      `No slots offered — ${eventTypeSource} is not configured (or zero)`,
    );
    return [];
  }

  const [timezone, daysAheadRaw, maxSlotsRaw] = await Promise.all([
    getConfig<string>('business_timezone', 'America/Chicago'),
    getConfig<number>('slot_suggestion_days', 7),
    getConfig<number>('slot_suggestion_count', 3),
  ]);

  const daysAhead = typeof daysAheadRaw === 'number' ? daysAheadRaw : parseInt(String(daysAheadRaw), 10) || 7;
  const maxSlots = typeof maxSlotsRaw === 'number' ? maxSlotsRaw : parseInt(String(maxSlotsRaw), 10) || 3;

  const { fetchAvailableSlots } = await import('@/services/cal-slots.service');
  const slots = await fetchAvailableSlots({
    apiKey,
    eventTypeId: eventTypeIdNum,
    calcomUrl,
    timezone,
    daysAhead,
    maxSlots: Math.min(Math.max(maxSlots, 1), 5),
    bypassCache,
  });

  if (slots.length === 0) {
    log.warn(
      { caseId, intent, eventTypeId: eventTypeIdNum, daysAhead, timezone, bypassCache },
      'No slots offered — Cal.com returned empty (all booked, filtered as past, or API error)',
    );
  } else {
    log.info({ caseId, count: slots.length, eventTypeId: eventTypeIdNum, bypassCache }, 'Slots fetched for reply');
  }

  return slots;
}

async function generateReplyText(params: {
  row: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  businessName: string;
  businessPhone: string;
  calcomUrl: string;
  calcomLabel: string;
  pricingInfo: string | null;
  isEmergency: boolean;
  slotOptions?: Array<{ date_display: string; time_display: string }>;
}): Promise<string> {
  const { row, businessName, businessPhone, calcomUrl, calcomLabel, pricingInfo, isEmergency, slotOptions } = params;

  let context = '';

  if (slotOptions && slotOptions.length > 0) {
    const slotList = slotOptions.map((s) => `- ${s.date_display} at ${s.time_display}`).join('\n');
    context += `
The customer will see these specific available time slots as clickable buttons below your reply:
${slotList}

Briefly acknowledge the upcoming availability (e.g., "I have a few openings this week") but do NOT list the specific times in your text — the buttons render them separately. One short sentence is enough.
`;
  }

  if (isEmergency) {
    context += `
CRITICAL — This is an EMERGENCY. You MUST include safety instructions at the TOP before anything else.

SAFETY INSTRUCTIONS (include ALL that may be relevant):
- Gas smell: Leave the building immediately. Do NOT use light switches or electronics. Call 911 and your gas company from outside.
- Flooding/active water leak: Turn off the main water shut-off valve if you can safely reach it. If water is near electrical outlets, panels, or appliances, do NOT touch the water.
- Sparking/electrical emergency: Stay clear of the affected area. Do not touch anything. If there is fire risk, call 911.
- Sewage backup: Avoid contact with sewage water. Do not use any drains connected to the affected line. Open windows for ventilation.
- Carbon monoxide: Leave the building immediately with all occupants and pets. Call 911.

After safety instructions, state: "A technician will contact you within 15 minutes."
Do NOT promise a specific arrival time.
`;
  }

  if (pricingInfo) {
    context += `
Include this pricing estimate (preface with "Here are our typical price ranges for reference"):
${pricingInfo}
Add this disclaimer after pricing: "Final pricing is always determined after an on-site diagnosis. No surprises — we confirm the price before starting any work."
`;
  }

  if (row.preferred_times) {
    context += `\nThe customer mentioned preferred times: "${row.preferred_times}". Acknowledge this and say you'll do your best to accommodate.\n`;
  }

  context += `\nInclude a call-to-action for booking: "${calcomLabel}" at ${calcomUrl}`;
  context += `\nAlso offer calling at ${businessPhone} as an alternative.\n`;

  // Load admin-editable system prompt template; fall back to baked-in default
  // if the template table isn't present or the row was deleted.
  const { renderTemplateByKey } = await import('@/services/template.service');
  const rendered = await renderTemplateByKey('composer_system_prompt', { business_name: businessName });
  const systemPrompt = rendered?.body ?? `You are writing a customer reply email on behalf of "${businessName}".

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
- Never make promises about timing you can't keep.`;

  const userPrompt = `Write a reply to this customer email:

CUSTOMER: ${row.customer_name || 'Customer'} (${row.customer_email || row.from_email})
SUBJECT: ${row.subject || '(no subject)'}
THEIR MESSAGE SUMMARY: ${row.problem_summary || 'No details provided'}
TRADE: ${row.trade || 'unknown'}
URGENCY: ${row.urgency_level || 'ROUTINE'}
SERVICE TYPE: ${row.requested_service || 'general service'}
${row.service_address ? 'ADDRESS: ' + row.service_address : ''}
${row.customer_phone ? 'PHONE: ' + row.customer_phone : ''}
${row.attachments_present ? 'NOTE: Customer included attachments (photos/docs).' : ''}

ADDITIONAL CONTEXT:
${context}

Write the reply paragraphs now. Plain text only, no formatting, no signature.`;

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: getModel(),
    max_tokens: 1200,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  });

  const content = (response.content[0]?.type === 'text' ? response.content[0].text : '').trim();

  // Clean any accidental markdown/formatting
  return content
    .replace(/```/g, '')
    .replace(/^Subject:.*\n/im, '')
    .replace(/^Re:.*\n/im, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim();
}

/** Template-based fallback when LLM is unavailable. Uses DB template if available. */
async function generateFallbackReply(params: {
  row: Record<string, unknown>;
  businessName: string;
  businessPhone: string;
  calcomUrl: string;
  calcomLabel: string;
  pricingInfo: string | null;
  isEmergency: boolean;
  slotOptions?: Array<{ date_display: string; time_display: string }>;
}): Promise<string> {
  const { row, businessName, businessPhone, isEmergency } = params;
  const name = (row.customer_name as string) || 'there';
  const summary = (row.problem_summary as string) || 'your inquiry';

  const { renderTemplateByKey } = await import('@/services/template.service');
  const key = isEmergency ? 'fallback_reply_emergency' : 'fallback_reply_standard';
  const rendered = await renderTemplateByKey(key, {
    customer_name: name,
    business_name: businessName,
    business_phone: businessPhone,
    problem_summary: summary,
  });
  if (rendered) return rendered.body;

  // Hardcoded fallback if template is missing
  if (isEmergency) {
    return `Hi ${name},

Thank you for reaching out. We understand this is urgent and are treating it as a priority.

If you are in any immediate danger, please call 911 first. For gas leaks, leave the building immediately and do not use any light switches or electronics.

A technician from ${businessName} will contact you within 15 minutes. You can also reach us directly at ${businessPhone}.

Click the button below to confirm your emergency appointment.`;
  }

  return `Hi ${name},

Thank you for contacting ${businessName} about ${summary}. We've received your message and want to help.

To get started, click the button below to schedule a convenient time, or call us directly at ${businessPhone}.

We look forward to assisting you!`;
}

function maskEmail(email: string): string {
  if (!email) return 'n/a';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return user.substring(0, 2) + '***@' + domain;
}
