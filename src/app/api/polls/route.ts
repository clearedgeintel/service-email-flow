import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 500);
  const queue = request.nextUrl.searchParams.get('queue') || 'gmail-intake';

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('poll_history')
    .select('id, queue_name, started_at, finished_at, duration_ms, messages_found, cases_inserted, error, metadata')
    .eq('queue_name', queue)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const polls = data || [];

  // Compute quick summary stats
  const last = polls[0] || null;
  const last24h = polls.filter(
    (p) => new Date((p as { started_at: string }).started_at).getTime() > Date.now() - 24 * 60 * 60 * 1000,
  );
  const totalMessages = last24h.reduce(
    (sum, p) => sum + ((p as { messages_found: number }).messages_found || 0),
    0,
  );
  const errorCount = last24h.filter((p) => (p as { error: string | null }).error).length;

  return NextResponse.json({
    polls,
    last,
    stats_24h: {
      total_polls: last24h.length,
      messages_found: totalMessages,
      errors: errorCount,
    },
  });
}
