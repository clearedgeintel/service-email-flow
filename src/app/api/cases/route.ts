import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const status = params.get('status');
  const intent = params.get('intent');
  const urgency = params.get('urgency');
  const trade = params.get('trade');
  const from = params.get('from');
  const to = params.get('to');
  const search = params.get('search');
  const page = parseInt(params.get('page') || '1');
  const limit = Math.min(parseInt(params.get('limit') || '25'), 100);
  const sort = params.get('sort') || 'received_at';
  const order = params.get('order') === 'asc' ? true : false;

  const supabase = getSupabase();
  let query = supabase
    .from('email_cases')
    .select('*', { count: 'exact' });

  if (status) query = query.eq('status', status);
  if (intent) query = query.eq('intent', intent);
  if (urgency) query = query.eq('urgency_level', urgency);
  if (trade) query = query.eq('trade', trade);
  if (from) query = query.gte('received_at', from);
  if (to) query = query.lte('received_at', to);
  if (search) {
    query = query.or(
      `subject.ilike.%${search}%,customer_name.ilike.%${search}%,problem_summary.ilike.%${search}%,from_email.ilike.%${search}%`,
    );
  }

  const offset = (page - 1) * limit;
  query = query.order(sort, { ascending: order }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    cases: data,
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
