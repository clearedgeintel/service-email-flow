import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getQueue, QUEUE_NAMES, QueueName } from '@/lib/queue';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const queueNames = Object.values(QUEUE_NAMES);
  const health: Record<string, { waiting: number; active: number; completed: number; failed: number }> = {};

  for (const name of queueNames) {
    try {
      const queue = getQueue(name);
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ]);
      health[name] = { waiting, active, completed, failed };
    } catch {
      health[name] = { waiting: -1, active: -1, completed: -1, failed: -1 };
    }
  }

  return NextResponse.json({ queues: health });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { queue: queueName } = await request.json();

  if (!queueName || !Object.values(QUEUE_NAMES).includes(queueName as QueueName)) {
    return NextResponse.json(
      { error: `Invalid queue. Valid: ${Object.values(QUEUE_NAMES).join(', ')}` },
      { status: 400 },
    );
  }

  const queue = getQueue(queueName as QueueName);
  const job = await queue.add('manual-trigger', {});

  return NextResponse.json({ success: true, jobId: job.id, queue: queueName });
}
