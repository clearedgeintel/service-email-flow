import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('calls')
    .select(`
      id, retell_call_id, direction, status, agent_id,
      from_number, to_number, caller_name,
      started_at, ended_at, duration_seconds,
      disconnection_reason, transcript, transcript_object, recording_url,
      summary, sentiment, call_successful, in_voicemail, custom_data,
      created_at
    `)
    .eq('case_id', id)
    .order('started_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ calls: data || [] });
}
