import Retell from 'retell-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { getRetellApiKey, isRetellEnabled } from '@/services/retell.service';
import { getBusinessHoursConfig, isAfterHours } from '@/lib/business-hours';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('outbound-call');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  // Respect business hours — admin can force by POSTing { force: true }
  let force = false;
  try {
    const body = await request.clone().json();
    force = body?.force === true;
  } catch { /* empty body is fine */ }

  if (!force) {
    const hoursConfig = await getBusinessHoursConfig();
    if (isAfterHours(hoursConfig)) {
      return NextResponse.json(
        {
          error: 'Outside configured business hours. Re-submit with { "force": true } to call anyway.',
          after_hours: true,
        },
        { status: 409 },
      );
    }
  }

  const enabled = await isRetellEnabled();
  if (!enabled) {
    return NextResponse.json({ error: 'Retell integration is disabled in Settings.' }, { status: 400 });
  }

  const apiKey = await getRetellApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'Retell API key not configured.' }, { status: 400 });
  }

  const outboundAgentId = await getConfig<string>('retell_outbound_agent_id', '');
  if (!outboundAgentId) {
    return NextResponse.json({ error: 'Outbound Retell agent ID not configured.' }, { status: 400 });
  }

  const { id } = await params;
  const caseId = parseInt(id);
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('id, customer_name, customer_phone, problem_summary, trade, urgency_level, intent')
    .eq('id', caseId)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  }

  const c = row as {
    id: number;
    customer_name: string | null;
    customer_phone: string | null;
    problem_summary: string | null;
    trade: string | null;
    urgency_level: string | null;
    intent: string | null;
  };

  if (!c.customer_phone) {
    return NextResponse.json(
      { error: 'No customer phone number on file. Add one to the case first.' },
      { status: 400 },
    );
  }

  // Need a from_number — use the configured Twilio/Retell number from settings
  const fromNumber = await getConfig<string>('twilio_from_number', '');
  if (!fromNumber) {
    return NextResponse.json(
      { error: 'No outbound phone number configured. Set "Twilio From Number" in Settings.' },
      { status: 400 },
    );
  }

  // Inject case context into the agent prompt via dynamic variables
  const businessName = await getConfig<string>('business_name', 'ClearDesk');
  const businessPhone = await getConfig<string>('business_phone', '');

  try {
    const client = new Retell({ apiKey });
    const phoneCall = await client.call.createPhoneCall({
      from_number: fromNumber,
      to_number: c.customer_phone,
      override_agent_id: outboundAgentId,
      metadata: {
        cleardesk_case_id: caseId,
        triggered_by: 'admin',
      },
      retell_llm_dynamic_variables: {
        business_name: businessName,
        business_phone: businessPhone,
        customer_name: c.customer_name || 'there',
        problem_summary: c.problem_summary || 'their service request',
        trade: c.trade || 'service',
        urgency: c.urgency_level || 'ROUTINE',
        intent: c.intent || 'GENERAL_QUESTION',
      },
    });

    // Pre-create a call row linked to the case so it shows up immediately
    await supabase.from('calls').upsert({
      retell_call_id: phoneCall.call_id,
      case_id: caseId,
      direction: 'outbound',
      status: 'registered',
      agent_id: outboundAgentId,
      from_number: fromNumber,
      to_number: c.customer_phone,
      metadata: { cleardesk_case_id: caseId, triggered_by: 'admin' },
    }, { onConflict: 'retell_call_id' });

    await logCaseEvent({
      caseId,
      eventType: EventType.MANUAL_ACTION,
      actor: 'admin',
      summary: `Outbound call triggered to ${c.customer_phone}`,
      metadata: {
        retell_call_id: phoneCall.call_id,
        agent_id: outboundAgentId,
      },
    });

    log.info({ caseId, callId: phoneCall.call_id }, 'Outbound call created');

    return NextResponse.json({
      success: true,
      call_id: phoneCall.call_id,
      message: `Call queued. Customer phone will ring shortly. Webhook events will populate the case timeline.`,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ caseId, err }, 'Failed to create outbound call');
    return NextResponse.json({ error: `Retell error: ${errorMsg}` }, { status: 500 });
  }
}
