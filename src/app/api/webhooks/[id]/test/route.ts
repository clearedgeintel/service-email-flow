import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .select('id, active')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  const sub = data as { id: number; active: boolean };
  if (!sub.active) {
    return NextResponse.json({ error: 'Subscription is disabled' }, { status: 400 });
  }

  // Enqueue a test delivery
  try {
    const { getQueue, QUEUE_NAMES } = await import('@/lib/queue');
    const queue = getQueue(QUEUE_NAMES.WEBHOOK_DISPATCH);
    await queue.add('test', {
      subscriptionId: sub.id,
      eventType: 'webhook.test',
      caseId: null,
      payload: {
        event: 'webhook.test',
        case_id: null,
        timestamp: new Date().toISOString(),
        data: { message: 'This is a ClearDesk webhook test delivery.' },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Test delivery queued — check Deliveries for the result.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to enqueue test' },
      { status: 500 },
    );
  }
}
