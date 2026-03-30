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

  // Reset status to RECEIVED so classifier picks it up
  const { error } = await supabase
    .from('email_cases')
    .update({ status: 'RECEIVED', confidence: null, intent: null })
    .eq('id', caseId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enqueue classifier job
  const queue = getQueue(QUEUE_NAMES.CLASSIFIER);
  await queue.add('reclassify', { caseId } as CaseJobData);

  await logCaseEvent({
    caseId,
    eventType: EventType.MANUAL_ACTION,
    actor: 'admin',
    summary: 'Manual reclassification triggered',
  });

  return NextResponse.json({ success: true, message: 'Reclassification enqueued' });
}
