import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  // Rate limit manual polls: 6 per minute per instance
  const limited = rateLimit('manual-poll', 6, 60_000);
  if (limited) return limited;

  try {
    const { getQueue, QUEUE_NAMES } = await import('@/lib/queue');
    const queue = getQueue(QUEUE_NAMES.GMAIL_INTAKE);
    const job = await queue.add(
      'manual-poll',
      { trigger: 'manual' },
      {
        // Dedupe: if a manual poll is already pending, reuse it
        jobId: `manual-${Date.now()}`,
        removeOnComplete: { count: 100 },
      },
    );

    return NextResponse.json({
      success: true,
      job_id: job.id,
      message: 'Poll queued. Watch the poll history for results.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to enqueue poll' },
      { status: 500 },
    );
  }
}
