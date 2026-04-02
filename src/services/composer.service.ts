import { getOpenAI, getModel } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';
import { getGmail } from '@/lib/gmail';
import { getConfig } from '@/lib/config';
import { buildHtmlEmail, buildPricingTableHtml } from '@/lib/email-template';
import { createChildLogger } from '@/lib/logger';
import { withCircuitBreaker } from '@/lib/circuit-breaker';
import { logCaseEvent } from './case-event.service';
import { lookupPricing, formatPricingForPrompt } from './pricing.service';
import { EventType } from '@/types/events';

const log = createChildLogger('composer');

export async function composeAndSendReply(caseId: number): Promise<void> {
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

  // Build LLM prompt with circuit breaker fallback
  const replyParams = {
    row,
    businessName,
    businessPhone,
    calcomUrl,
    calcomLabel,
    pricingInfo: hasPricing ? formatPricingForPrompt(pricingItems) : null,
    isEmergency,
  };

  const { result: replyText, usedFallback } = await withCircuitBreaker(
    { name: 'openai-composer', failureThreshold: 3, resetTimeout: 60_000 },
    () => generateReplyText(replyParams),
    () => Promise.resolve(generateFallbackReply(replyParams)),
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

  // Send via Gmail
  const gmail = getGmail();
  const sendAs = process.env.GMAIL_SEND_AS || '';

  const rawMessage = buildRawEmail({
    to: customerEmail,
    from: sendAs,
    subject: `Re: ${row.subject || '(no subject)'}`,
    html: htmlEmail,
  });

  const sendResult = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: rawMessage },
  });

  // Update case
  const { error: updateError } = await supabase
    .from('email_cases')
    .update({
      customer_reply_sent: true,
      customer_reply_at: new Date().toISOString(),
    })
    .eq('id', caseId);

  if (updateError) {
    log.error({ caseId, error: updateError }, 'Failed to update reply status');
  }

  // Log event
  await logCaseEvent({
    caseId,
    eventType: EventType.REPLY_SENT,
    summary: `Customer reply sent to ${maskEmail(customerEmail)} — ${isEmergency ? 'EMERGENCY' : row.urgency_level}`,
    metadata: {
      gmail_send_id: sendResult.data.id,
      has_pricing: hasPricing,
      calcom_url: calcomUrl,
      is_emergency: isEmergency,
    },
  });

  log.info(
    { caseId, to: maskEmail(customerEmail), emergency: isEmergency },
    'Customer reply sent',
  );
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

async function generateReplyText(params: {
  row: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  businessName: string;
  businessPhone: string;
  calcomUrl: string;
  calcomLabel: string;
  pricingInfo: string | null;
  isEmergency: boolean;
}): Promise<string> {
  const { row, businessName, businessPhone, calcomUrl, calcomLabel, pricingInfo, isEmergency } = params;

  let context = '';

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

  const systemPrompt = `You are writing a customer reply email on behalf of "${businessName}".

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

  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: getModel(),
    temperature: 0.4,
    max_tokens: 1200,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = (response.choices[0]?.message?.content || '').trim();

  // Clean any accidental markdown/formatting
  return content
    .replace(/```/g, '')
    .replace(/^Subject:.*\n/im, '')
    .replace(/^Re:.*\n/im, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim();
}

function buildRawEmail(params: {
  to: string;
  from: string;
  subject: string;
  html: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const raw = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(params.html).toString('base64'),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Template-based fallback when OpenAI is unavailable */
function generateFallbackReply(params: {
  row: Record<string, unknown>;
  businessName: string;
  businessPhone: string;
  calcomUrl: string;
  calcomLabel: string;
  pricingInfo: string | null;
  isEmergency: boolean;
}): string {
  const { row, businessName, businessPhone, isEmergency } = params;
  const name = (row.customer_name as string) || 'there';

  if (isEmergency) {
    return `Hi ${name},

Thank you for reaching out. We understand this is urgent and are treating it as a priority.

If you are in any immediate danger, please call 911 first. For gas leaks, leave the building immediately and do not use any light switches or electronics.

A technician from ${businessName} will contact you within 15 minutes. You can also reach us directly at ${businessPhone}.

Click the button below to confirm your emergency appointment.`;
  }

  const summary = (row.problem_summary as string) || 'your inquiry';

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
