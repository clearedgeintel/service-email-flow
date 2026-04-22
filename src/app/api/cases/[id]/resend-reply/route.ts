import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getQueue, QUEUE_NAMES } from '@/lib/queue';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';
import type { ComposerJobData } from '@/workers/composer.worker';

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

  // Enqueue composer job with bypassSlotCache. The slot cache is in-memory
  // per process — on Railway, web and worker are separate processes, so
  // clearing cache here wouldn't touch the worker's cache. Instead we flag
  // this specific job as cache-bypass so the worker forces a fresh Cal.com
  // fetch. This is the path to use when an admin has just corrected config
  // that caused an initial empty-slot result to be cached.
  const queue = getQueue(QUEUE_NAMES.COMPOSER);
  await queue.add('resend', { caseId, bypassSlotCache: true } as ComposerJobData);

  await logCaseEvent({
    caseId,
    eventType: EventType.MANUAL_ACTION,
    actor: 'admin',
    summary: 'Manual reply resend triggered',
  });

  return NextResponse.json({ success: true, message: 'Reply resend enqueued' });
}
