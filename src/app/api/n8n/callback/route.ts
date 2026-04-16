import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { requireN8nAuth } from '@/lib/n8n-auth';
import { rateLimit } from '@/lib/rate-limit';
import { logCaseEvent } from '@/services/case-event.service';
import { emitWebhookEvent } from '@/services/webhook.service';
import { EventType } from '@/types/events';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('n8n-callback');

const AddNoteSchema = z.object({
  action: z.literal('add_note'),
  case_id: z.number().int().positive(),
  note: z.string().min(1).max(2000),
  actor: z.string().max(50).optional(),
});

const UpdateStatusSchema = z.object({
  action: z.literal('update_status'),
  case_id: z.number().int().positive(),
  status: z.enum([
    'RECEIVED', 'CLASSIFIED', 'RESPONDED_PENDING_BOOKING',
    'ESCALATED', 'NEEDS_REVIEW', 'NEEDS_MANUAL_CALL', 'CLOSED',
  ]),
  reason: z.string().max(500).optional(),
});

const CloseCaseSchema = z.object({
  action: z.literal('close_case'),
  case_id: z.number().int().positive(),
  disposition: z.string().max(200).optional(),
});

const TriggerFollowupSchema = z.object({
  action: z.literal('trigger_followup'),
  case_id: z.number().int().positive(),
});

const AddEventSchema = z.object({
  action: z.literal('add_event'),
  case_id: z.number().int().positive(),
  event_type: z.string().max(50).default('NOTE_ADDED'),
  summary: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CallbackSchema = z.discriminatedUnion('action', [
  AddNoteSchema,
  UpdateStatusSchema,
  CloseCaseSchema,
  TriggerFollowupSchema,
  AddEventSchema,
]);

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const limited = rateLimit(`n8n-callback:${ip}`, 120, 60_000);
  if (limited) return limited;

  const authError = await requireN8nAuth(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CallbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message, path: parsed.error.issues[0].path },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const payload = parsed.data;

  // Ensure the case exists for every action (gives a clear 404 instead of silent miss)
  const { data: row, error: fetchErr } = await supabase
    .from('email_cases')
    .select('id, status')
    .eq('id', payload.case_id)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  try {
    switch (payload.action) {
      case 'add_note':
        return await handleAddNote(payload);

      case 'update_status':
        return await handleUpdateStatus(payload);

      case 'close_case':
        return await handleCloseCase(payload);

      case 'trigger_followup':
        return await handleTriggerFollowup(payload);

      case 'add_event':
        return await handleAddEvent(payload);
    }
  } catch (err) {
    log.error({ err, action: payload.action, caseId: payload.case_id }, 'n8n callback failed');
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Callback processing failed' },
      { status: 500 },
    );
  }
}

async function handleAddNote(p: z.infer<typeof AddNoteSchema>) {
  const supabase = getSupabase();
  const { data: current } = await supabase
    .from('email_cases')
    .select('notes')
    .eq('id', p.case_id)
    .single();

  const actor = p.actor || 'n8n';
  const stamped = `${(current?.notes || '').trim()} | [${actor}] ${p.note}`.trim();

  const { error } = await supabase
    .from('email_cases')
    .update({ notes: stamped })
    .eq('id', p.case_id);

  if (error) throw new Error(error.message);

  await logCaseEvent({
    caseId: p.case_id,
    eventType: EventType.NOTE_ADDED,
    actor,
    summary: p.note.substring(0, 200),
  });

  emitWebhookEvent('case.note_added', p.case_id, { note: p.note, source: 'n8n' });

  return NextResponse.json({ success: true, action: 'add_note', case_id: p.case_id });
}

async function handleUpdateStatus(p: z.infer<typeof UpdateStatusSchema>) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('email_cases')
    .update({ status: p.status })
    .eq('id', p.case_id);

  if (error) throw new Error(error.message);

  await logCaseEvent({
    caseId: p.case_id,
    eventType: EventType.STATUS_CHANGED,
    actor: 'n8n',
    summary: p.reason || `Status set to ${p.status}`,
    metadata: { status: p.status, reason: p.reason || null },
  });

  return NextResponse.json({ success: true, action: 'update_status', case_id: p.case_id, status: p.status });
}

async function handleCloseCase(p: z.infer<typeof CloseCaseSchema>) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('email_cases')
    .update({ status: 'CLOSED' })
    .eq('id', p.case_id);

  if (error) throw new Error(error.message);

  await logCaseEvent({
    caseId: p.case_id,
    eventType: EventType.CLOSED,
    actor: 'n8n',
    summary: p.disposition || 'Closed by n8n workflow',
    metadata: { disposition: p.disposition || null },
  });

  emitWebhookEvent('case.closed', p.case_id, {
    closed_by: 'n8n',
    disposition: p.disposition || null,
  });

  return NextResponse.json({ success: true, action: 'close_case', case_id: p.case_id });
}

async function handleTriggerFollowup(p: z.infer<typeof TriggerFollowupSchema>) {
  const { sendFollowup } = await import('@/services/followup.service');

  await logCaseEvent({
    caseId: p.case_id,
    eventType: EventType.MANUAL_ACTION,
    actor: 'n8n',
    summary: 'Follow-up triggered by n8n',
  });

  await sendFollowup(p.case_id);

  return NextResponse.json({ success: true, action: 'trigger_followup', case_id: p.case_id });
}

async function handleAddEvent(p: z.infer<typeof AddEventSchema>) {
  // Free-form event — lets n8n record arbitrary external work (e.g. "SMS
  // sent to oncall tech", "Slack thread opened") in the case timeline.
  const allowedTypes = Object.values(EventType) as string[];
  const eventType = allowedTypes.includes(p.event_type)
    ? (p.event_type as EventType)
    : EventType.NOTE_ADDED;

  await logCaseEvent({
    caseId: p.case_id,
    eventType,
    actor: 'n8n',
    summary: p.summary,
    metadata: p.metadata,
  });

  return NextResponse.json({ success: true, action: 'add_event', case_id: p.case_id, event_type: eventType });
}
