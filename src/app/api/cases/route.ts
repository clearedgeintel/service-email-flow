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

  const { status, intent, urgency, trade, from, to, search, channel, page, limit, sort, order } = parsed.data;

  const supabase = getSupabase();

  // When search or channel filter is set, we need to resolve matching case IDs
  // across related tables before applying to the main query.
  let restrictToIds: number[] | null = null;

  if (search || channel) {
    const idSet = new Set<number>();

    if (search) {
      // Search across email_cases fields, call transcripts/summaries, and SMS bodies
      const [emailMatch, callMatch, smsMatch] = await Promise.all([
        supabase
          .from('email_cases')
          .select('id')
          .or(
            `subject.ilike.%${search}%,customer_name.ilike.%${search}%,problem_summary.ilike.%${search}%,from_email.ilike.%${search}%,body_cleaned.ilike.%${search}%`,
          )
          .limit(500),
        supabase
          .from('calls')
          .select('case_id')
          .or(
            `transcript.ilike.%${search}%,summary.ilike.%${search}%,caller_name.ilike.%${search}%`,
          )
          .not('case_id', 'is', null)
          .limit(200),
        supabase
          .from('sms_messages')
          .select('case_id')
          .ilike('body', `%${search}%`)
          .not('case_id', 'is', null)
          .limit(200),
      ]);

      for (const row of (emailMatch.data || []) as Array<{ id: number }>) idSet.add(row.id);
      for (const row of (callMatch.data || []) as Array<{ case_id: number }>) idSet.add(row.case_id);
      for (const row of (smsMatch.data || []) as Array<{ case_id: number }>) idSet.add(row.case_id);
    }

    if (channel) {
      // Restrict to cases that originated from or have activity in the specified channel
      let channelIds: Set<number>;

      if (channel === 'voice') {
        const { data } = await supabase
          .from('calls')
          .select('case_id')
          .not('case_id', 'is', null)
          .limit(1000);
        channelIds = new Set((data || []).map((r: any) => r.case_id as number));
      } else if (channel === 'sms') {
        const { data } = await supabase
          .from('sms_messages')
          .select('case_id')
          .not('case_id', 'is', null)
          .limit(1000);
        channelIds = new Set((data || []).map((r: any) => r.case_id as number));
      } else {
        // email = cases whose gmail_message_id does NOT start with 'retell:' or 'sms:'
        const { data } = await supabase
          .from('email_cases')
          .select('id')
          .not('gmail_message_id', 'like', 'retell:%')
          .not('gmail_message_id', 'like', 'sms:%')
          .limit(1000);
        channelIds = new Set((data || []).map((r: any) => r.id as number));
      }

      if (search) {
        // Intersect search results with channel filter
        for (const id of idSet) {
          if (!channelIds.has(id)) idSet.delete(id);
        }
      } else {
        for (const id of channelIds) idSet.add(id);
      }
    }

    if (idSet.size === 0) {
      return NextResponse.json({
        cases: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      });
    }

    restrictToIds = [...idSet];
  }

  let query = supabase
    .from('email_cases')
    .select('*', { count: 'exact' });

  if (restrictToIds) {
    query = query.in('id', restrictToIds);
  }

  if (status) {
    query = query.eq('status', status);
  } else {
    query = query.neq('status', 'CLOSED');
  }
  if (intent) query = query.eq('intent', intent);
  if (urgency) query = query.eq('urgency_level', urgency);
  if (trade) query = query.eq('trade', trade);
  if (from) query = query.gte('received_at', from);
  if (to) query = query.lte('received_at', to);

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
