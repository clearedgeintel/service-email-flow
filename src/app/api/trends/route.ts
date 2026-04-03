import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTrends, getFeedbackStats } from '@/services/smart.service';

/** GET /api/trends?days=30 — Weekly trends + feedback accuracy stats */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const days = parseInt(request.nextUrl.searchParams.get('days') || '30');
  const safeDays = Math.min(Math.max(days, 7), 365);

  const [trends, feedbackStats] = await Promise.all([
    getTrends(safeDays),
    getFeedbackStats(),
  ]);

  return NextResponse.json({
    period_days: safeDays,
    weeks: trends,
    feedback: feedbackStats,
  });
}
