import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const from = params.get('from') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = params.get('to') || new Date().toISOString();

  const supabase = getSupabase();

  // Fetch cases in date range
  const { data: cases } = await supabase
    .from('email_cases')
    .select('status, intent, urgency_level, trade, received_at, customer_reply_at, customer_reply_sent, followup_count')
    .gte('received_at', from)
    .lte('received_at', to);

  const all = cases || [];

  // Aggregate counts
  const byStatus: Record<string, number> = {};
  const byIntent: Record<string, number> = {};
  const byUrgency: Record<string, number> = {};
  const byTrade: Record<string, number> = {};
  const byDay: Record<string, number> = {};

  let totalResponseTimeMs = 0;
  let responseCount = 0;
  let followupConversions = 0;
  let followupTotal = 0;

  for (const c of all) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    if (c.intent) byIntent[c.intent] = (byIntent[c.intent] || 0) + 1;
    if (c.urgency_level) byUrgency[c.urgency_level] = (byUrgency[c.urgency_level] || 0) + 1;
    if (c.trade) byTrade[c.trade] = (byTrade[c.trade] || 0) + 1;

    // Daily volume
    const day = c.received_at?.substring(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;

    // Response time
    if (c.customer_reply_at && c.received_at) {
      const diff = new Date(c.customer_reply_at).getTime() - new Date(c.received_at).getTime();
      if (diff > 0) {
        totalResponseTimeMs += diff;
        responseCount++;
      }
    }

    // Follow-up conversion
    if (c.followup_count > 0) {
      followupTotal++;
      if (c.status === 'CLOSED' || c.customer_reply_sent) {
        followupConversions++;
      }
    }
  }

  // Count stuck items
  const { count: stuckCount } = await supabase
    .from('email_cases')
    .select('id', { count: 'exact', head: true })
    .or(
      'status.eq.NEEDS_REVIEW,status.eq.NEEDS_MANUAL_CALL',
    );

  const avgResponseMinutes = responseCount > 0
    ? Math.round(totalResponseTimeMs / responseCount / 60000)
    : null;

  return NextResponse.json({
    totalCases: all.length,
    byStatus,
    byIntent,
    byUrgency,
    byTrade,
    byDay,
    avgResponseMinutes,
    followupConversionRate: followupTotal > 0
      ? Math.round((followupConversions / followupTotal) * 100)
      : null,
    stuckCount: stuckCount || 0,
    dateRange: { from, to },
  });
}
