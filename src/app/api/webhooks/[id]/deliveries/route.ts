import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 200);

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('id, event_type, case_id, attempt, status, response_status, error, sent_at, completed_at')
    .eq('subscription_id', id)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deliveries: data || [] });
}
