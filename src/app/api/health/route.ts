import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, string | Record<string, unknown>> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  // Check Supabase
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();
    const { error } = await supabase.from('settings').select('key').limit(1);
    checks.database = error ? `error: ${error.message}` : 'ok';
  } catch (e) {
    checks.database = `error: ${e instanceof Error ? e.message : 'unknown'}`;
  }

  // Check Redis
  try {
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    const pong = await redis.ping();
    checks.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
  } catch (e) {
    checks.redis = `error: ${e instanceof Error ? e.message : 'unknown'}`;
  }

  // Check queue health (waiting + active job counts)
  try {
    const { getQueue, QUEUE_NAMES } = await import('@/lib/queue');
    const queueHealth: Record<string, unknown> = {};

    for (const [key, name] of Object.entries(QUEUE_NAMES)) {
      try {
        const queue = getQueue(name as typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES]);
        const [waiting, active, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getFailedCount(),
        ]);
        queueHealth[key] = { waiting, active, failed };
      } catch {
        queueHealth[key] = 'unavailable';
      }
    }

    checks.queues = queueHealth;
  } catch {
    checks.queues = 'unavailable';
  }

  const healthy = checks.database === 'ok' && checks.redis === 'ok';

  return NextResponse.json(checks, { status: healthy ? 200 : 503 });
}
