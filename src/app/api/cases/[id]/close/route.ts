import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
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

  const { data: row, error } = await supabase
    .from('email_cases')
    .update({ status: 'CLOSED' })
    .eq('id', caseId)
    .select('gmail_message_id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sync Gmail label
  const { syncMessageLabel } = await import('@/lib/gmail-labels');
  await syncMessageLabel(row?.gmail_message_id || null, 'CLOSED');

  await logCaseEvent({
    caseId,
    eventType: EventType.CLOSED,
    actor: 'admin',
    summary: 'Case manually closed',
  });

  const { emitWebhookEvent } = await import('@/services/webhook.service');
  emitWebhookEvent('case.closed', caseId, { closed_by: 'admin' });

  return NextResponse.json({ success: true, message: 'Case closed' });
}
