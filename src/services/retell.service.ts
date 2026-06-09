import Retell from 'retell-sdk';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';
import { logCaseEvent } from './case-event.service';
import { EventType } from '@/types/events';
import {
  getBusinessHoursConfig,
  isAfterHours,
  describeBusinessHours,
} from '@/lib/business-hours';

const log = createChildLogger('retell');

export type RetellEventType = 'call_inbound' | 'call_started' | 'call_ended' | 'call_analyzed';

interface RetellCallPayload {
  call_type?: string;
  call_id: string;
  agent_id?: string;
  direction?: 'inbound' | 'outbound';
  call_status?: string;
  from_number?: string;
  to_number?: string;
  metadata?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, unknown>;
  start_timestamp?: number;
  end_timestamp?: number;
  disconnection_reason?: string;
  transcript?: string;
  transcript_object?: unknown[];
  recording_url?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: 'Positive' | 'Negative' | 'Neutral' | 'Unknown';
    call_successful?: boolean;
    in_voicemail?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
}

export interface RetellWebhookPayload {
  event: RetellEventType;
  call: RetellCallPayload;
  // For call_inbound events Retell sends `call_inbound` instead of `call`.
  call_inbound?: {
    agent_id?: string;
    from_number?: string;
    to_number?: string;
  };
}

export interface RetellInboundResponse {
  call_inbound: {
    override_agent_id?: string;
    dynamic_variables?: Record<string, string>;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Build the response payload for Retell's `call_inbound` event. Retell sends
 * this right before answering the call — our response can override the agent
 * (e.g. after-hours voicemail agent) and inject dynamic variables that the
 * agent's prompt references at runtime.
 */
export async function buildInboundResponse(
  fromNumber: string | undefined,
): Promise<RetellInboundResponse> {
  const [
    businessName,
    businessPhone,
    afterHoursAgentId,
    hoursConfig,
  ] = await Promise.all([
    getConfig<string>('business_name', 'ClearDesk'),
    getConfig<string>('business_phone', ''),
    getConfig<string>('retell_after_hours_agent_id', ''),
    getBusinessHoursConfig(),
  ]);

  const afterHours = isAfterHours(hoursConfig);

  // Try to look up caller by phone so the agent can greet them by name
  let callerName = '';
  if (fromNumber) {
    const caseId = await findCaseForCall(fromNumber);
    if (caseId) {
      const { data } = await getSupabase()
        .from('email_cases')
        .select('customer_name')
        .eq('id', caseId)
        .single();
      if (data && (data as { customer_name: string | null }).customer_name) {
        callerName = (data as { customer_name: string }).customer_name;
      }
    }
  }

  const response: RetellInboundResponse = {
    call_inbound: {
      dynamic_variables: {
        business_name: businessName,
        business_phone: businessPhone,
        business_hours: describeBusinessHours(hoursConfig),
        is_after_hours: String(afterHours),
        known_caller_name: callerName,
      },
      metadata: {
        cleardesk_source: 'inbound',
        after_hours: afterHours,
      },
    },
  };

  if (afterHours && afterHoursAgentId) {
    response.call_inbound.override_agent_id = afterHoursAgentId;
  }

  return response;
}

/** Verify Retell webhook signature using their SDK helper */
export async function verifyRetellSignature(
  rawBody: string,
  signature: string,
  apiKey: string,
): Promise<boolean> {
  if (!signature || !apiKey) return false;
  try {
    const result = Retell.verify(rawBody, apiKey, signature);
    return result instanceof Promise ? await result : Boolean(result);
  } catch (err) {
    log.warn({ err }, 'Retell.verify threw');
    return false;
  }
}

/**
 * Try to match an incoming call to an existing open case by phone number.
 * Returns null if no match — caller will decide whether to create a new case.
 */
async function findCaseForCall(phoneNumber: string | undefined): Promise<number | null> {
  if (!phoneNumber) return null;
  const supabase = getSupabase();

  // Strip non-digits for fuzzy matching (varying formats: +1-555-123-4567 vs 5551234567)
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length < 7) return null;

  // Try exact match first, then tail match (last 10 digits)
  const tail = digits.slice(-10);
  const { data } = await supabase
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
 * Create a new case from an inbound Retell call. Used when the caller
 * has no existing open case — extracts name/problem/urgency from the
 * call's custom_analysis_data populated by the Retell agent.
 */
async function createCaseFromCall(call: RetellCallPayload): Promise<number | null> {
  const supabase = getSupabase();
  const custom = (call.call_analysis?.custom_analysis_data || {}) as Record<string, unknown>;

  const customerName = (custom.caller_name || custom.customer_name || '') as string;
  const problem = (custom.problem || custom.issue || custom.problem_summary || call.call_analysis?.call_summary || 'Voice call — no details captured') as string;
  const trade = (custom.trade || 'unknown') as string;
  const urgency = (custom.urgency || custom.urgency_level || 'ROUTINE') as string;
  const address = (custom.service_address || custom.address || null) as string | null;

  // Use a deterministic fake gmail_message_id so we can still dedupe on retry
  const fakeGmailId = `retell:${call.call_id}`;

  const { getDefaultTenantId } = await import('@/lib/tenant');
  const tenantId = await getDefaultTenantId();

  const { data, error } = await supabase
    .from('email_cases')
    .insert({
      tenant_id: tenantId,
      gmail_message_id: fakeGmailId,
      from_email: 'voice@cleardesk.internal',
      from_name: customerName || 'Voice caller',
      subject: `Voice call from ${customerName || call.from_number || 'unknown caller'}`,
      body_cleaned: problem,
      body_raw: call.transcript || problem,
      snippet: problem.substring(0, 200),
      status: 'CLASSIFIED',
      intent: urgency === 'EMERGENCY' ? 'EMERGENCY' : 'REPAIR_REQUEST',
      confidence: 0.85,
      customer_name: customerName || null,
      customer_phone: call.from_number || null,
      service_address: address,
      problem_summary: problem.substring(0, 500),
      trade,
      urgency_level: urgency,
      received_at: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    log.error({ error, callId: call.call_id }, 'Failed to create case from voice call');
    return null;
  }

  const caseId = (data as { id: number }).id;

  await logCaseEvent({
    caseId,
    eventType: EventType.RECEIVED,
    actor: 'retell',
    summary: `Inbound voice call from ${customerName || call.from_number || 'unknown'}`,
    metadata: {
      source: 'retell',
      retell_call_id: call.call_id,
      from_number: call.from_number,
    },
  });

  return caseId;
}

/** Upsert a call row and optionally link it to a case */
async function upsertCall(
  call: RetellCallPayload,
  caseId: number | null,
  updates: Record<string, unknown> = {},
): Promise<void> {
  const supabase = getSupabase();

  // Phase 1 single-tenant: stamp the default tenant on every row. PR2B +
  // Phase 3 switch to deriving tenant_id from the request's TenantContext.
  const { getDefaultTenantId } = await import('@/lib/tenant');
  const tenantId = await getDefaultTenantId();

  const base: Record<string, unknown> = {
    tenant_id: tenantId,
    retell_call_id: call.call_id,
    case_id: caseId,
    direction: call.direction || 'inbound',
    status: call.call_status || 'in_progress',
    agent_id: call.agent_id || null,
    from_number: call.from_number || null,
    to_number: call.to_number || null,
    started_at: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : null,
    ended_at: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : null,
    duration_seconds: call.start_timestamp && call.end_timestamp
      ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
      : null,
    disconnection_reason: call.disconnection_reason || null,
    transcript: call.transcript || null,
    transcript_object: call.transcript_object || null,
    recording_url: call.recording_url || null,
    metadata: call.metadata || null,
    ...updates,
  };

  // Strip nulls from updates so upsert doesn't overwrite existing values
  const patch = Object.fromEntries(
    Object.entries(base).filter(([, v]) => v !== null && v !== undefined),
  );

  const { error } = await supabase
    .from('calls')
    .upsert(patch, { onConflict: 'retell_call_id' });

  if (error) {
    log.warn({ error, callId: call.call_id }, 'Failed to upsert call row');
  }
}

/**
 * Process a Retell webhook event. Verifies already done at the route layer.
 * For inbound calls, links to an existing case or creates one when enough
 * data is captured (at call_analyzed time).
 */
export async function processRetellWebhook(payload: RetellWebhookPayload): Promise<{
  handled: boolean;
  caseId: number | null;
  callId: string;
  action?: string;
}> {
  const { event, call } = payload;
  const direction = call.direction || 'inbound';

  // On call_started: register the call, try to link by phone
  if (event === 'call_started') {
    const caseId = direction === 'inbound'
      ? await findCaseForCall(call.from_number)
      : null;

    // Flag inbound calls that arrive outside business hours for reporting
    const updates: Record<string, unknown> = { status: 'in_progress' };
    if (direction === 'inbound') {
      const hoursConfig = await getBusinessHoursConfig();
      updates.after_hours = isAfterHours(
        hoursConfig,
        call.start_timestamp ? new Date(call.start_timestamp) : new Date(),
      );
    }

    await upsertCall(call, caseId, updates);
    log.info({ callId: call.call_id, direction, caseId, afterHours: updates.after_hours }, 'Retell call started');
    return { handled: true, caseId, callId: call.call_id, action: 'started' };
  }

  // On call_ended: update with transcript/duration, but don't create case yet
  // (wait for call_analyzed to get structured data)
  if (event === 'call_ended') {
    const { data: existing } = await getSupabase()
      .from('calls')
      .select('case_id')
      .eq('retell_call_id', call.call_id)
      .maybeSingle();
    const caseId = existing ? (existing as { case_id: number | null }).case_id : null;
    await upsertCall(call, caseId, { status: 'ended' });
    log.info({ callId: call.call_id, duration: call.end_timestamp }, 'Retell call ended');

    // Emit outbound event so Zapier/n8n can react
    const { emitWebhookEvent } = await import('./webhook.service');
    emitWebhookEvent('call.ended', caseId, {
      retell_call_id: call.call_id,
      direction,
      from_number: call.from_number,
      duration_seconds: call.start_timestamp && call.end_timestamp
        ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
        : null,
      disconnection_reason: call.disconnection_reason,
    });

    return { handled: true, caseId, callId: call.call_id, action: 'ended' };
  }

  // On call_analyzed: extract structured data, create case if inbound + no match
  if (event === 'call_analyzed') {
    const analysis = call.call_analysis;

    // First check if the call row was already linked to a case
    const { data: existing } = await getSupabase()
      .from('calls')
      .select('case_id')
      .eq('retell_call_id', call.call_id)
      .maybeSingle();
    let caseId: number | null = existing ? (existing as { case_id: number | null }).case_id : null;

    // If inbound and no case yet, create one from the call analysis
    if (!caseId && direction === 'inbound') {
      caseId = await createCaseFromCall(call);
    }

    // Update call with analysis data
    const analysisUpdates: Record<string, unknown> = {
      status: 'ended',
      case_id: caseId,
    };
    if (analysis) {
      if (analysis.call_summary) analysisUpdates.summary = analysis.call_summary;
      if (analysis.user_sentiment) analysisUpdates.sentiment = analysis.user_sentiment;
      if (typeof analysis.call_successful === 'boolean') analysisUpdates.call_successful = analysis.call_successful;
      if (typeof analysis.in_voicemail === 'boolean') analysisUpdates.in_voicemail = analysis.in_voicemail;
      if (analysis.custom_analysis_data) analysisUpdates.custom_data = analysis.custom_analysis_data;

      // Also pull caller name into its own column for easier querying
      const customerName = analysis.custom_analysis_data?.caller_name
        || analysis.custom_analysis_data?.customer_name;
      if (customerName) analysisUpdates.caller_name = customerName;
    }

    await upsertCall(call, caseId, analysisUpdates);

    if (caseId) {
      const turns = extractTranscriptTurns(call.transcript_object, call.transcript);
      const durationSec = call.start_timestamp && call.end_timestamp
        ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
        : null;

      await logCaseEvent({
        caseId,
        eventType: EventType.VOICE_TRANSCRIPT,
        actor: 'retell',
        summary: analysis?.call_summary
          || (turns.length ? `Voice call — ${turns.length} turns` : 'Voice call'),
        metadata: {
          retell_call_id: call.call_id,
          direction,
          from_number: call.from_number,
          to_number: call.to_number,
          duration_seconds: durationSec,
          sentiment: analysis?.user_sentiment,
          call_successful: analysis?.call_successful,
          in_voicemail: analysis?.in_voicemail,
          recording_url: call.recording_url || null,
          turns,
        },
      });
    }

    log.info(
      { callId: call.call_id, caseId, sentiment: analysis?.user_sentiment },
      'Retell call analyzed',
    );
    return { handled: true, caseId, callId: call.call_id, action: 'analyzed' };
  }

  return { handled: false, caseId: null, callId: call.call_id, action: 'ignored' };
}

interface TranscriptTurn {
  role: 'agent' | 'user';
  content: string;
}

/**
 * Normalize Retell's transcript_object (or raw transcript string) into a
 * compact [{role, content}] array suitable for rendering in the case timeline.
 * Drops word-level timing to keep the event row small.
 */
export function extractTranscriptTurns(
  transcriptObject: unknown,
  transcript: string | null | undefined,
): TranscriptTurn[] {
  if (Array.isArray(transcriptObject)) {
    const turns: TranscriptTurn[] = [];
    for (const item of transcriptObject) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const role = rec.role === 'user' ? 'user' : rec.role === 'agent' ? 'agent' : null;
      const content = typeof rec.content === 'string' ? rec.content.trim() : '';
      if (role && content) turns.push({ role, content });
    }
    if (turns.length) return turns;
  }

  // Fallback: parse "Agent: ...\nUser: ..." style string transcript
  if (typeof transcript === 'string' && transcript.trim()) {
    const turns: TranscriptTurn[] = [];
    for (const line of transcript.split(/\r?\n/)) {
      const match = line.match(/^\s*(Agent|User|Customer|Assistant)\s*:\s*(.+)$/i);
      if (!match) continue;
      const speaker = match[1].toLowerCase();
      const role: 'agent' | 'user' = speaker === 'user' || speaker === 'customer' ? 'user' : 'agent';
      turns.push({ role, content: match[2].trim() });
    }
    return turns;
  }

  return [];
}

/** Load the Retell API key from settings (or env as fallback) */
export async function getRetellApiKey(): Promise<string> {
  const fromSettings = await getConfig<string>('retell_api_key', '');
  if (fromSettings) return fromSettings;
  return process.env.RETELL_API_KEY || '';
}

/** Check if Retell integration is enabled */
export async function isRetellEnabled(): Promise<boolean> {
  const raw = await getConfig<unknown>('retell_enabled', false);
  return raw === true || raw === 'true';
}
