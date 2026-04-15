import { NextResponse } from 'next/server';

export async function GET() {
  const mailbox = process.env.GMAIL_SEND_AS || '';

  let dbOk = false;
  let redisOk = false;
  interface LastPoll {
    started_at: string;
    finished_at: string | null;
    messages_found: number;
    cases_inserted: number;
    error: string | null;
  }
  let lastPoll: LastPoll | null = null;

  // Check database + fetch last Gmail poll
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();
    const { error } = await supabase.from('settings').select('key').limit(1);
    dbOk = !error;

    if (dbOk) {
      const { data } = await supabase
        .from('poll_history')
        .select('started_at, finished_at, messages_found, cases_inserted, error')
        .eq('queue_name', 'gmail-intake')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        lastPoll = data as unknown as LastPoll;
      }
    }
  } catch {
    dbOk = false;
  }

  // Check Redis
  try {
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    const pong = await redis.ping();
    redisOk = pong === 'PONG';
  } catch {
    redisOk = false;
  }

  // Stale poll detection: if last poll is more than 5 minutes old, workers may be down
  let workerStatus: 'running' | 'stale' | 'unknown' = 'unknown';
  if (lastPoll?.started_at) {
    const ageMs = Date.now() - new Date(lastPoll.started_at).getTime();
    workerStatus = ageMs < 5 * 60 * 1000 ? 'running' : 'stale';
  }

  return NextResponse.json({
    mailbox,
    healthy: dbOk && redisOk,
    database: dbOk ? 'ok' : 'error',
    redis: redisOk ? 'ok' : 'error',
    gmail_configured: !!process.env.GMAIL_CLIENT_ID && !!process.env.GMAIL_REFRESH_TOKEN,
    worker_status: workerStatus,
    last_poll: lastPoll,
  });
}
