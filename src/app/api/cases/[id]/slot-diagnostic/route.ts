import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { fetchAvailableSlots, clearSlotCache } from '@/services/cal-slots.service';

/**
 * GET /api/cases/[id]/slot-diagnostic
 *
 * Explains exactly why (or why not) slots are being offered in this case's
 * reply. Runs the same gate chain as the composer, plus a live Cal.com call,
 * and returns a structured report. Bypasses the slot cache so the result
 * reflects the live state of Cal.com.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const caseId = parseInt(id);
  const supabase = getSupabase();

  const { data: row, error } = await supabase
    .from('email_cases')
    .select('id, intent, urgency_level, status')
    .eq('id', caseId)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  const c = row as { id: number; intent: string | null; urgency_level: string | null; status: string };
  const isEmergency = c.status === 'ESCALATED' || c.urgency_level === 'EMERGENCY';

  // Gate 1: toggle
  const enabledRaw = await getConfig<unknown>('smart_scheduling_enabled', false);
  const enabled = enabledRaw === true || enabledRaw === 'true';
  if (!enabled) {
    return NextResponse.json({
      case_id: caseId,
      slots_offered: 0,
      reason: 'smart_scheduling_disabled',
      message: 'Smart Scheduling is off. Enable it in Settings → "Smart Scheduling (Cal.com Slots)" toggle.',
    });
  }

  // Gate 2: API key
  const apiKey = await getConfig<string>('calcom_api_key', '');
  if (!apiKey) {
    return NextResponse.json({
      case_id: caseId,
      slots_offered: 0,
      reason: 'no_calcom_api_key',
      message: 'calcom_api_key is empty. Paste it into Settings → Smart Scheduling.',
    });
  }

  // Gate 3: event type for this case's intent
  let eventTypeKey: string;
  if (isEmergency) eventTypeKey = 'calcom_event_type_emergency';
  else if (c.intent === 'REPAIR_REQUEST') eventTypeKey = 'calcom_event_type_service';
  else eventTypeKey = 'calcom_event_type_estimate';

  const rawEventType = await getConfig<unknown>(eventTypeKey, 0);
  const eventTypeId = typeof rawEventType === 'number' ? rawEventType : parseInt(String(rawEventType), 10);
  if (!eventTypeId || isNaN(eventTypeId)) {
    return NextResponse.json({
      case_id: caseId,
      slots_offered: 0,
      intent: c.intent,
      is_emergency: isEmergency,
      event_type_key: eventTypeKey,
      event_type_configured: String(rawEventType ?? ''),
      reason: 'event_type_not_configured',
      message: `This case routes to "${eventTypeKey}" but that setting is empty or 0. Set it in Settings → Smart Scheduling.`,
    });
  }

  // Gate 4: live Cal.com call (cache-busted)
  clearSlotCache();

  const [calcomUrl, timezone, daysAhead] = await Promise.all([
    isEmergency
      ? getConfig<string>('calcom_emergency_url', '')
      : c.intent === 'REPAIR_REQUEST'
        ? getConfig<string>('calcom_service_url', '')
        : getConfig<string>('calcom_estimate_url', ''),
    getConfig<string>('business_timezone', 'America/Chicago'),
    getConfig<number>('slot_suggestion_days', 7),
  ]);

  const slots = await fetchAvailableSlots({
    apiKey,
    eventTypeId,
    calcomUrl: calcomUrl || 'https://cal.com',
    timezone,
    daysAhead: typeof daysAhead === 'number' ? daysAhead : parseInt(String(daysAhead), 10) || 7,
    maxSlots: 10,
  });

  if (slots.length === 0) {
    return NextResponse.json({
      case_id: caseId,
      slots_offered: 0,
      intent: c.intent,
      is_emergency: isEmergency,
      event_type_id: eventTypeId,
      event_type_key: eventTypeKey,
      timezone,
      days_ahead: daysAhead,
      reason: 'calcom_returned_empty',
      message: 'Cal.com returned no slots in the window. Possible causes: event type has no availability, all slots are outside the 30-min runway, Cal.com API is down, or the booking URL hasn\'t synced availability yet.',
    });
  }

  return NextResponse.json({
    case_id: caseId,
    slots_offered: slots.length,
    intent: c.intent,
    is_emergency: isEmergency,
    event_type_id: eventTypeId,
    event_type_key: eventTypeKey,
    timezone,
    days_ahead: daysAhead,
    reason: 'ok',
    first_slot: slots[0],
    preview: slots.slice(0, 3).map((s) => `${s.date_display} · ${s.time_display}`),
  });
}
