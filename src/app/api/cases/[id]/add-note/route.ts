import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';
import { CaseNoteSchema } from '@/lib/validation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const caseId = parseInt(id);
  const body = await request.json();
  const parsed = CaseNoteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const note = parsed.data.note.trim();
  const supabase = getSupabase();

  // Get current notes
  const { data: current } = await supabase
    .from('email_cases')
    .select('notes')
    .eq('id', caseId)
    .single();

  const updatedNotes = (current?.notes || '') + ` | [Admin] ${note}`;

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
    summary: note.substring(0, 200),
  });

  return NextResponse.json({ success: true });
}
