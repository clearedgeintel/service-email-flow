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
  const caseId = parseInt(id);

  const { data, error } = await getSupabase()
    .from('sms_messages')
    .select(`
      id, twilio_sid, direction, status,
      from_number, to_number, body,
      num_media, media_urls,
      error_code, error_message,
      sent_at, delivered_at, received_at, created_at
    `)
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data || [] });
}
