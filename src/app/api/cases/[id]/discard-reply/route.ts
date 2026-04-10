import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getGmail } from '@/lib/gmail';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const caseId = parseInt(id);
  const supabase = getSupabase();

  const { data: row } = await supabase
    .from('email_cases')
    .select('draft_gmail_id')
    .eq('id', caseId)
    .single();

  // Best-effort delete the Gmail draft
  if (row?.draft_gmail_id) {
    try {
      const gmail = getGmail();
      await gmail.users.drafts.delete({
        userId: 'me',
        id: row.draft_gmail_id,
      });
    } catch {
      // Non-critical — draft may already be gone
    }
  }

  await supabase
    .from('email_cases')
    .update({
      draft_reply: null,
      draft_gmail_id: null,
    })
    .eq('id', caseId);

  await logCaseEvent({
    caseId,
    eventType: EventType.MANUAL_ACTION,
    actor: 'admin',
    summary: 'Draft reply discarded by admin',
  });

  return NextResponse.json({ success: true });
}
