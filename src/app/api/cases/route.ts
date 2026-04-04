import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { CaseQuerySchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = CaseQuerySchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { status, intent, urgency, trade, from, to, search, page, limit, sort, order } = parsed.data;

  const supabase = getSupabase();
  let query = supabase
    .from('email_cases')
    .select('*', { count: 'exact' });

  if (status) {
    query = query.eq('status', status);
  } else {
    // Hide closed and spam by default
    query = query.neq('status', 'CLOSED');
  }
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
  query = query.order(sort, { ascending: order === 'asc' }).range(offset, offset + limit - 1);

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
