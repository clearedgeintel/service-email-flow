import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getCaseTimeline } from '@/services/case-event.service';
import { CaseUpdateSchema } from '@/lib/validation';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('email_cases')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  const timeline = await getCaseTimeline(parseInt(id));

  return NextResponse.json({ case: data, timeline });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const parsed = CaseUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('email_cases')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sync Gmail label if status changed
  if (parsed.data.status && data) {
    const { syncMessageLabel } = await import('@/lib/gmail-labels');
    await syncMessageLabel(data.gmail_message_id, parsed.data.status);
  }

  return NextResponse.json({ case: data });
}
