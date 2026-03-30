import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const caseId = parseInt(id);
  const { note } = await request.json();

  if (!note || typeof note !== 'string' || note.trim().length === 0) {
    return NextResponse.json({ error: 'Note text is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Get current notes
  const { data: current } = await supabase
    .from('email_cases')
    .select('notes')
    .eq('id', caseId)
    .single();

  const updatedNotes = (current?.notes || '') + ` | [Admin] ${note.trim()}`;

  const { error } = await supabase
    .from('email_cases')
    .update({ notes: updatedNotes })
    .eq('id', caseId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logCaseEvent({
    caseId,
    eventType: EventType.NOTE_ADDED,
    actor: 'admin',
    summary: note.trim().substring(0, 200),
  });

  return NextResponse.json({ success: true });
}
