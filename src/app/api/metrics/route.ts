import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Run queries in parallel
    const [
      statusCounts,
      intentCounts,
      recentCases,
      replyStats,
      confidenceStats,
      stuckCases,
      recentErrors,
    ] = await Promise.all([
      // Cases by status
      supabase.from('email_cases').select('status', { count: 'exact', head: true }),
      // Cases by intent (last 24h)
      supabase.from('email_cases').select('intent').gte('received_at', oneDayAgo),
      // Cases received in last hour
      supabase.from('email_cases').select('id', { count: 'exact', head: true }).gte('received_at', oneHourAgo),
      // Reply latency: cases with replies in last 24h
      supabase.from('email_cases')
        .select('received_at, customer_reply_at')
        .eq('customer_reply_sent', true)
        .gte('customer_reply_at', oneDayAgo),
      // Average confidence in last hour
      supabase.from('email_cases')
        .select('confidence')
        .gte('received_at', oneHourAgo)
        .not('confidence', 'is', null),
      // Stuck cases: RECEIVED for >10 min
      supabase.from('email_cases')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'RECEIVED')
        .lt('received_at', new Date(now.getTime() - 10 * 60 * 1000).toISOString()),
      // Recent errors from case_events
      supabase.from('case_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'ERROR')
        .gte('created_at', oneHourAgo),
    ]);

    // Compute intent distribution
    const intentDistribution: Record<string, number> = {};
    if (intentCounts.data) {
      for (const row of intentCounts.data) {
        const intent = (row as Record<string, unknown>).intent as string || 'unknown';
        intentDistribution[intent] = (intentDistribution[intent] || 0) + 1;
      }
    }

    // Compute average reply latency
    let avgReplyLatencyMs = 0;
    let replyCount = 0;
    if (replyStats.data) {
      for (const row of replyStats.data) {
        const r = row as Record<string, string>;
        if (r.received_at && r.customer_reply_at) {
          const latency = new Date(r.customer_reply_at).getTime() - new Date(r.received_at).getTime();
          if (latency > 0) {
            avgReplyLatencyMs += latency;
            replyCount++;
          }
        }
      }
      if (replyCount > 0) avgReplyLatencyMs = Math.round(avgReplyLatencyMs / replyCount);
    }

    // Compute average confidence
    let avgConfidence = 0;
    let confidenceCount = 0;
    if (confidenceStats.data) {
      for (const row of confidenceStats.data) {
        const conf = (row as Record<string, unknown>).confidence;
        if (typeof conf === 'number') {
          avgConfidence += conf;
          confidenceCount++;
        }
      }
      if (confidenceCount > 0) avgConfidence = avgConfidence / confidenceCount;
    }

    const metrics = {
      timestamp: now.toISOString(),
      cases: {
        total: statusCounts.count || 0,
        received_last_hour: recentCases.count || 0,
        stuck_received: stuckCases.count || 0,
        intent_distribution_24h: intentDistribution,
      },
      performance: {
        avg_reply_latency_ms: avgReplyLatencyMs,
        avg_reply_latency_readable: avgReplyLatencyMs > 0
          ? `${Math.round(avgReplyLatencyMs / 1000)}s`
          : 'n/a',
        replies_last_24h: replyCount,
      },
      classification: {
        avg_confidence_last_hour: Math.round(avgConfidence * 100) / 100,
        classified_last_hour: confidenceCount,
        low_confidence_alert: avgConfidence > 0 && avgConfidence < 0.5,
      },
      errors: {
        error_events_last_hour: recentErrors.count || 0,
      },
    };

    return NextResponse.json(metrics);
  } catch (e) {
    return NextResponse.json(
      { error: `Metrics unavailable: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 503 },
    );
  }
}
