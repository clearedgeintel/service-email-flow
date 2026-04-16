import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getQueue, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';

export async function POST(
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
    .update({
      status: 'ESCALATED',
      urgency_level: 'EMERGENCY',
      requires_tech_notify: true,
    })
    .eq('id', caseId)
    .select('gmail_message_id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sync Gmail label
  const { syncMessageLabel } = await import('@/lib/gmail-labels');
  await syncMessageLabel(row?.gmail_message_id || null, 'ESCALATED');

  // Enqueue tech notification
  const queue = getQueue(QUEUE_NAMES.NOTIFIER);
  await queue.add('escalate', { caseId } as CaseJobData);

  await logCaseEvent({
    caseId,
    eventType: EventType.ESCALATED,
    actor: 'admin',
    summary: 'Manually escalated to EMERGENCY',
  });

  const { emitWebhookEvent } = await import('@/services/webhook.service');
  emitWebhookEvent('case.escalated', caseId, { escalated_by: 'admin' });

  return NextResponse.json({ success: true, message: 'Case escalated' });
}
