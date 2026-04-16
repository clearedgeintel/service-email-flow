import { getAnthropic, getModel } from '@/lib/anthropic';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';
import { withCircuitBreaker } from '@/lib/circuit-breaker';
import { sendOutboundSms } from './sms.service';

const log = createChildLogger('sms-reply');

const MAX_HISTORY = 6;      // recent turns to include as context
const MAX_REPLY_CHARS = 320; // keep it tight — single SMS segment when possible

export async function isSmsAutoReplyEnabled(): Promise<boolean> {
  const raw = await getConfig<unknown>('sms_auto_reply_enabled', false);
  return raw === true || raw === 'true';
}

/**
 * True if we recently sent an outbound SMS on this case — avoids runaway
 * reply storms when a customer rapid-fires multiple texts.
 */
async function isThrottled(caseId: number, throttleMinutes: number): Promise<boolean> {
  if (throttleMinutes <= 0) return false;

  const since = new Date(Date.now() - throttleMinutes * 60_000).toISOString();
  const { data } = await getSupabase()
    .from('sms_messages')
    .select('id')
    .eq('case_id', caseId)
    .eq('direction', 'outbound')
    .gte('created_at', since)
    .limit(1);

  return !!data && data.length > 0;
}

interface CaseRow {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  problem_summary: string | null;
  trade: string | null;
  urgency_level: string | null;
  intent: string | null;
}

interface ConversationTurn {
  direction: 'inbound' | 'outbound';
  body: string;
  at: string;
}

async function loadContext(caseId: number): Promise<{
  caseRow: CaseRow | null;
  history: ConversationTurn[];
}> {
  const supabase = getSupabase();

  const [caseResult, historyResult] = await Promise.all([
    supabase
      .from('email_cases')
      .select('id, customer_name, customer_phone, problem_summary, trade, urgency_level, intent')
      .eq('id', caseId)
      .single(),
    supabase
      .from('sms_messages')
      .select('direction, body, created_at')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY),
  ]);

  const caseRow = caseResult.data as CaseRow | null;
  const history = ((historyResult.data as Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>) || [])
    .filter((m) => m.body)
    .reverse()
    .map((m) => ({ direction: m.direction, body: m.body, at: m.created_at }));

  return { caseRow, history };
}

interface GenerateParams {
  caseRow: CaseRow;
  history: ConversationTurn[];
  inboundBody: string;
  businessName: string;
  businessPhone: string;
}

async function generateSmsReply(p: GenerateParams): Promise<string> {
  const anthropic = getAnthropic();
  const model = getModel();

  const systemPrompt = `You are a warm, professional dispatcher at ${p.businessName} responding to a customer by SMS text message.

Rules:
- Maximum ${MAX_REPLY_CHARS} characters. Shorter is better.
- Plain text only. No emojis unless the customer uses them first. No markdown, no links unless the customer asked for one.
- Sound like a human dispatcher, not a bot. Contractions OK.
- Acknowledge their specific issue in one short phrase.
- State the concrete next step (a tech will call them back, confirm an address, confirm a time, etc.).
- Never make up specific times, prices, or technician names.
- If the customer mentions an emergency (leak, no heat in winter, no AC in extreme heat, sparks, shock), treat with urgency and tell them to call ${p.businessPhone} right now.
- End with no signature — SMS doesn't need one.

Context about the customer:
- Name: ${p.caseRow.customer_name || 'not yet captured'}
- Known problem: ${p.caseRow.problem_summary || 'not yet captured'}
- Trade: ${p.caseRow.trade || 'unknown'}
- Urgency level on file: ${p.caseRow.urgency_level || 'unknown'}
- Case intent: ${p.caseRow.intent || 'unknown'}`;

  const historyMessages = p.history
    .filter((h) => h.body !== p.inboundBody) // avoid duplicating the just-received message
    .slice(-MAX_HISTORY)
    .map((h) => ({
      role: h.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: h.body,
    }));

  const response = await anthropic.messages.create({
    model,
    max_tokens: 250,
    system: systemPrompt,
    messages: [
      ...historyMessages,
      { role: 'user', content: p.inboundBody },
    ],
  });

  const first = response.content[0];
  const text = first && first.type === 'text' ? first.text.trim() : '';
  if (!text) throw new Error('Empty reply from Claude');

  // Hard-cap in case Claude overshoots
  return text.length > MAX_REPLY_CHARS ? text.substring(0, MAX_REPLY_CHARS - 1) + '…' : text;
}

function fallbackReply(p: GenerateParams): string {
  const firstName = p.caseRow.customer_name?.split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName}` : 'Hi';
  return `${greeting}, thanks for the text — we got it and someone will reach out shortly. For anything urgent, call ${p.businessPhone}.`;
}

/**
 * Compose and send an SMS reply for a case based on the most recent
 * inbound message. Respects throttling. Idempotent in the sense that
 * throttling will prevent back-to-back replies if invoked twice.
 */
export async function composeAndSendSmsReply(params: {
  caseId: number;
  inboundBody: string;
}): Promise<{ sent: boolean; reason?: string; twilioSid?: string }> {
  const { caseId, inboundBody } = params;

  if (!(await isSmsAutoReplyEnabled())) {
    return { sent: false, reason: 'disabled' };
  }

  const throttleMinutes = Number(await getConfig<unknown>('sms_auto_reply_throttle_minutes', 2));
  if (await isThrottled(caseId, throttleMinutes)) {
    log.info({ caseId, throttleMinutes }, 'SMS auto-reply throttled');
    return { sent: false, reason: 'throttled' };
  }

  const { caseRow, history } = await loadContext(caseId);
  if (!caseRow || !caseRow.customer_phone) {
    log.warn({ caseId }, 'Case missing customer_phone — cannot auto-reply');
    return { sent: false, reason: 'no_phone' };
  }

  const [businessName, businessPhone] = await Promise.all([
    getConfig<string>('business_name', 'ClearDesk'),
    getConfig<string>('business_phone', ''),
  ]);

  const genParams: GenerateParams = { caseRow, history, inboundBody, businessName, businessPhone };

  const { result: body, usedFallback } = await withCircuitBreaker(
    { name: 'sms-auto-reply', failureThreshold: 3, resetTimeout: 60_000 },
    () => generateSmsReply(genParams),
    () => Promise.resolve(fallbackReply(genParams)),
  );

  if (usedFallback) {
    log.warn({ caseId }, 'SMS auto-reply used fallback template');
  }

  const result = await sendOutboundSms({
    caseId,
    toNumber: caseRow.customer_phone,
    body,
    actor: 'auto-sms-reply',
  });

  return { sent: true, twilioSid: result.twilioSid };
}
