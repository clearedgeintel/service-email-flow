import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { recordFeedback } from '@/services/smart.service';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';

const FeedbackSchema = z.object({
  correctedIntent: z.enum([
    'SALES_INQUIRY', 'REPAIR_REQUEST', 'EMERGENCY', 'BILLING',
    'GENERAL_QUESTION', 'JOB_APPLICANT', 'VENDOR', 'SPAM',
  ]).optional(),
  correctedUrgency: z.enum(['EMERGENCY', 'TODAY', 'THIS_WEEK', 'ROUTINE']).optional(),
  correctedTrade: z.enum(['electric', 'plumbing', 'both', 'unknown']).optional(),
  notes: z.string().max(1000).optional(),
}).refine(
  (data) => data.correctedIntent || data.correctedUrgency || data.correctedTrade,
  { message: 'At least one correction is required' },
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const caseId = parseInt(id);
  const body = await request.json();
  const parsed = FeedbackSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  try {
    await recordFeedback({ caseId, ...parsed.data });

    await logCaseEvent({
      caseId,
      eventType: EventType.MANUAL_ACTION,
      actor: 'admin',
      summary: `Classification corrected: ${Object.entries(parsed.data).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      metadata: parsed.data,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Feedback failed' },
      { status: 500 },
    );
  }
}
