import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { getGmail } from '@/lib/gmail';
import { buildRawEmail } from '@/lib/email-builder';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';

interface DraftReply {
  type?: 'reply' | 'followup'; // defaults to 'reply' for legacy drafts without type
  subject: string;
  body_text: string;
  body_html: string;
  to: string;
  followup_number?: number;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const caseId = parseInt(id);
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('draft_reply, draft_gmail_id, gmail_thread_id, gmail_message_id, subject, followup_count, notes')
    .eq('id', caseId)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  const draft = row.draft_reply as DraftReply | null;
  if (!draft) {
    return NextResponse.json({ error: 'No pending draft for this case' }, { status: 400 });
  }

  const gmail = getGmail();
  const sendAs = process.env.GMAIL_SEND_AS || '';

  // If we have a draft Gmail ID, send it directly (preserves the same draft).
  // Otherwise build a new raw message.
  try {
    if (row.draft_gmail_id) {
      await gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: row.draft_gmail_id },
      });
    } else {
      const rawMessage = buildRawEmail({
        to: draft.to,
        from: sendAs,
        subject: draft.subject,
        html: draft.body_html,
        text: draft.body_text,
      });
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: rawMessage, threadId: row.gmail_thread_id || undefined },
      });
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to send: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 },
    );
  }

  const isFollowup = draft.type === 'followup';
  const now = new Date().toISOString();

  // Update case: clear draft, mark appropriate state based on draft type
  const updates: Record<string, unknown> = {
    draft_reply: null,
    draft_gmail_id: null,
  };

  if (isFollowup) {
    // Followup approved: increment followup count and timestamp
    updates.followup_count = (row.followup_count || 0) + 1;
    updates.last_followup_at = now;
    // Don't change status or customer_reply_sent — both already set
  } else {
    // Initial reply approved: mark sent and transition status
    updates.customer_reply_sent = true;
    updates.customer_reply_at = now;
    updates.status = 'RESPONDED_PENDING_BOOKING';
  }

  await supabase.from('email_cases').update(updates).eq('id', caseId);

  // Sync Gmail label only when status changed (initial reply)
  if (!isFollowup) {
    const { syncMessageLabel } = await import('@/lib/gmail-labels');
    await syncMessageLabel(row.gmail_message_id, 'RESPONDED_PENDING_BOOKING');
  }

  await logCaseEvent({
    caseId,
    eventType: isFollowup ? EventType.FOLLOWUP_SENT : EventType.REPLY_SENT,
    actor: 'admin',
    summary: isFollowup
      ? `Follow-up #${draft.followup_number || (row.followup_count || 0) + 1} draft approved and sent by admin`
      : 'Draft approved and sent by admin',
  });

  return NextResponse.json({ success: true });
}
