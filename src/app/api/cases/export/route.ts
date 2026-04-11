import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { CaseQuerySchema } from '@/lib/validation';

const CSV_COLUMNS = [
  'id',
  'received_at',
  'from_email',
  'customer_name',
  'customer_phone',
  'service_address',
  'subject',
  'status',
  'intent',
  'urgency_level',
  'trade',
  'confidence',
  'sentiment_label',
  'problem_summary',
  'customer_reply_sent',
  'customer_reply_at',
  'tech_notified',
  'booking_status',
  'booking_start_at',
];

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

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

  const { status, intent, urgency, trade, from, to, search } = parsed.data;

  const supabase = getSupabase();
  let query = supabase.from('email_cases').select(CSV_COLUMNS.join(','));

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

  query = query.order('received_at', { ascending: false }).limit(10_000);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data || []) as unknown) as Array<Record<string, unknown>>;
  const header = CSV_COLUMNS.join(',');
  const body = rows
    .map((row) => CSV_COLUMNS.map((col) => escapeCsv(row[col])).join(','))
    .join('\n');

  const csv = header + '\n' + body;
  const timestamp = new Date().toISOString().split('T')[0];

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cases-${timestamp}.csv"`,
    },
  });
}
