import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { logCaseEvent } from '@/services/case-event.service';
import { sendFollowup } from '@/services/followup.service';
import { EventType } from '@/types/events';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const caseId = parseInt(id);

  await logCaseEvent({
    caseId,
    eventType: EventType.MANUAL_ACTION,
    actor: 'admin',
    summary: 'Manual follow-up triggered',
  });

  await sendFollowup(caseId);

  return NextResponse.json({ success: true, message: 'Follow-up sent' });
}
