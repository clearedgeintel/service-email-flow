import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { fetchAvailableSlots, clearSlotCache, probeCalcomSlots } from '@/services/cal-slots.service';

/**
 * GET /api/cases/[id]/slot-diagnostic
 *
 * Explains exactly why (or why not) slots are being offered in this case's
 * reply. Runs the same gate chain as the composer, plus a live Cal.com call,
 * and returns a structured report. Bypasses the slot cache so the result
 * reflects the live state of Cal.com.
 *
 * Query params:
 *   ?raw=true — also include the raw Cal.com request URL + response body in
 *   the output, so admins can see exactly what Cal.com sent back. Auth token
 *   is redacted.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const includeRaw = request.nextUrl.searchParams.get('raw') === 'true';

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

  const [calcomUrl, timezone, daysAhead, minLeadRaw] = await Promise.all([
    isEmergency
      ? getConfig<string>('calcom_emergency_url', '')
      : c.intent === 'REPAIR_REQUEST'
        ? getConfig<string>('calcom_service_url', '')
        : getConfig<string>('calcom_estimate_url', ''),
    getConfig<string>('business_timezone', 'America/Chicago'),
    getConfig<number>('slot_suggestion_days', 7),
    getConfig<number>('slot_suggestion_min_lead_minutes', 30),
  ]);

  const daysAheadNum = typeof daysAhead === 'number' ? daysAhead : parseInt(String(daysAhead), 10) || 7;
  const leadMin = typeof minLeadRaw === 'number' ? minLeadRaw : parseInt(String(minLeadRaw), 10);
  const minLeadMinutes = isNaN(leadMin) ? 30 : Math.max(0, leadMin);

  // Raw Cal.com round-trip if requested
  const raw = includeRaw
    ? await probeCalcomSlots({ apiKey, eventTypeId, timezone, daysAhead: daysAheadNum })
    : null;

  // Fetch WITH the configured lead filter (what the composer would see)
  const slots = await fetchAvailableSlots({
    apiKey,
    eventTypeId,
    calcomUrl: calcomUrl || 'https://cal.com',
    timezone,
    daysAhead: daysAheadNum,
    maxSlots: 10,
    minLeadMinutes,
  });

  if (slots.length === 0) {
    // Refetch with lead=0 to tell the admin if the culprit is specifically
    // the lead-time filter vs Cal.com returning nothing at all.
    const slotsNoLead = await fetchAvailableSlots({
      apiKey,
      eventTypeId,
      calcomUrl: calcomUrl || 'https://cal.com',
      timezone,
      daysAhead: daysAheadNum,
      maxSlots: 10,
      minLeadMinutes: 0,
      bypassCache: true,
    });

    if (slotsNoLead.length > 0) {
      return NextResponse.json({
        case_id: caseId,
        slots_offered: 0,
        intent: c.intent,
        is_emergency: isEmergency,
        event_type_id: eventTypeId,
        event_type_key: eventTypeKey,
        timezone,
        days_ahead: daysAheadNum,
        min_lead_minutes: minLeadMinutes,
        reason: 'all_slots_within_lead_window',
        message: `Cal.com has ${slotsNoLead.length} slot(s), but all are within the current ${minLeadMinutes}-minute lead-time window. Lower "slot_suggestion_min_lead_minutes" in Settings (set to 0 for testing).`,
        preview_if_lead_zero: slotsNoLead.slice(0, 3).map((s) => `${s.date_display} · ${s.time_display}`),
        ...(raw && { raw_calcom: raw }),
      });
    }

    return NextResponse.json({
      case_id: caseId,
      slots_offered: 0,
      intent: c.intent,
      is_emergency: isEmergency,
      event_type_id: eventTypeId,
      event_type_key: eventTypeKey,
      timezone,
      days_ahead: daysAheadNum,
      min_lead_minutes: minLeadMinutes,
      reason: 'calcom_returned_empty',
      message: 'Cal.com returned no slots at all (even with lead-time filter disabled). Possible causes: event type has no availability set, all slots are booked, Cal.com API is down, or the booking URL hasn\'t synced availability yet.',
      ...(raw && { raw_calcom: raw }),
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
    days_ahead: daysAheadNum,
    min_lead_minutes: minLeadMinutes,
    reason: 'ok',
    first_slot: slots[0],
    preview: slots.slice(0, 3).map((s) => `${s.date_display} · ${s.time_display}`),
    ...(raw && { raw_calcom: raw }),
  });
}
