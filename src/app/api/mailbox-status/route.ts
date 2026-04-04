import { NextResponse } from 'next/server';

export async function GET() {
  const mailbox = process.env.GMAIL_SEND_AS || '';

  let dbOk = false;
  let redisOk = false;

  // Check database
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();
    const { error } = await supabase.from('settings').select('key').limit(1);
    dbOk = !error;
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

  return NextResponse.json({
    mailbox,
    healthy: dbOk && redisOk,
    database: dbOk ? 'ok' : 'error',
    redis: redisOk ? 'ok' : 'error',
    gmail_configured: !!process.env.GMAIL_CLIENT_ID && !!process.env.GMAIL_REFRESH_TOKEN,
  });
}
