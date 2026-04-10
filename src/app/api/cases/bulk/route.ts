import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';

const BulkActionSchema = z.object({
  action: z.enum(['close', 'escalate', 'reclassify', 'set_status']),
  case_ids: z.array(z.number().int().positive()).min(1).max(500),
  status: z.enum([
    'RECEIVED', 'CLASSIFIED', 'RESPONDED_PENDING_BOOKING',
    'ESCALATED', 'NEEDS_REVIEW', 'NEEDS_MANUAL_CALL', 'CLOSED',
  ]).optional(),
});

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const parsed = BulkActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { action, case_ids, status } = parsed.data;
  const supabase = getSupabase();

  const updates: Record<string, unknown> = {};
  let eventType: EventType = EventType.MANUAL_ACTION;
  let summary: string;

  switch (action) {
    case 'close':
      updates.status = 'CLOSED';
      eventType = EventType.CLOSED;
      summary = 'Bulk closed by admin';
      break;
    case 'escalate':
      updates.status = 'ESCALATED';
      updates.urgency_level = 'EMERGENCY';
      updates.requires_tech_notify = true;
      eventType = EventType.ESCALATED;
      summary = 'Bulk escalated by admin';
      break;
    case 'reclassify':
      updates.status = 'RECEIVED';
      updates.intent = null;
      updates.confidence = null;
      summary = 'Bulk reclassify triggered by admin';
      break;
    case 'set_status':
      if (!status) {
        return NextResponse.json({ error: 'status required for set_status' }, { status: 400 });
      }
      updates.status = status;
      eventType = EventType.STATUS_CHANGED;
      summary = `Bulk status change to ${status}`;
      break;
  }

  const { error } = await supabase
    .from('email_cases')
    .update(updates)
    .in('id', case_ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log events and sync labels for each case
  const { syncMessageLabel } = await import('@/lib/gmail-labels');
  const { data: rows } = await supabase
    .from('email_cases')
    .select('id, gmail_message_id')
    .in('id', case_ids);

  await Promise.all([
    ...case_ids.map((caseId) =>
      logCaseEvent({ caseId, eventType, actor: 'admin', summary }),
    ),
    ...((rows || []) as Array<{ id: number; gmail_message_id: string | null }>).map((row) =>
      syncMessageLabel(row.gmail_message_id, updates.status as string),
    ),
  ]);

  // For reclassify, enqueue classifier jobs
  if (action === 'reclassify') {
    try {
      const { getQueue, QUEUE_NAMES } = await import('@/lib/queue');
      const queue = getQueue(QUEUE_NAMES.CLASSIFIER);
      await Promise.all(
        case_ids.map((caseId) => queue.add('reclassify', { caseId })),
      );
    } catch {
      // Non-critical — jobs can be retriggered manually
    }
  }

  return NextResponse.json({ success: true, affected: case_ids.length });
}
