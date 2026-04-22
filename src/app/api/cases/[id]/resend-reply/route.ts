import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getQueue, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { logCaseEvent } from '@/services/case-event.service';
import { clearSlotCache } from '@/services/cal-slots.service';
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

  // Reset reply status
  await supabase
    .from('email_cases')
    .update({ customer_reply_sent: false, customer_reply_at: null })
    .eq('id', caseId);

  // Bust the Cal.com slot cache. The composer memoizes slots for 5 min
  // keyed on eventTypeId:daysAhead:timezone; without this, an admin
  // correcting a "no slots offered" draft by clicking Resend would keep
  // hitting the same cached empty result until TTL expired.
  clearSlotCache();

  // Enqueue composer job
  const queue = getQueue(QUEUE_NAMES.COMPOSER);
  await queue.add('resend', { caseId } as CaseJobData);

  await logCaseEvent({
    caseId,
    eventType: EventType.MANUAL_ACTION,
    actor: 'admin',
    summary: 'Manual reply resend triggered',
  });

  return NextResponse.json({ success: true, message: 'Reply resend enqueued' });
}
