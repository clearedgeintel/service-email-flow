import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

const QuerySchema = z.object({
  direction: z.enum(['inbound', 'outbound']).optional(),
  sentiment: z.enum(['Positive', 'Negative', 'Neutral', 'Unknown']).optional(),
  status: z.string().optional(),
  case_id: z.coerce.number().optional(),
  search: z.string().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { direction, sentiment, status, case_id, search, from, to, page, limit } = parsed.data;
  const supabase = getSupabase();

  let query = supabase
    .from('calls')
    .select(`
      id, retell_call_id, case_id, direction, status, agent_id,
      from_number, to_number, caller_name,
      started_at, ended_at, duration_seconds,
      summary, sentiment, call_successful, in_voicemail,
      created_at
    `, { count: 'exact' });

  if (direction) query = query.eq('direction', direction);
  if (sentiment) query = query.eq('sentiment', sentiment);
  if (status) query = query.eq('status', status);
  if (case_id) query = query.eq('case_id', case_id);
  if (from) query = query.gte('started_at', from);
  if (to) query = query.lte('started_at', to);
  if (search) {
    query = query.or(
      `caller_name.ilike.%${search}%,from_number.ilike.%${search}%,to_number.ilike.%${search}%,summary.ilike.%${search}%`,
    );
  }

  const offset = (page - 1) * limit;
  query = query.order('started_at', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    calls: data || [],
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
