import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { isTwilioEnabled, sendOutboundSms } from '@/services/sms.service';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('outbound-sms');

const BodySchema = z.object({
  body: z.string().min(1).max(1600),
  to: z.string().min(7).max(32).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  if (!(await isTwilioEnabled())) {
    return NextResponse.json({ error: 'Twilio is disabled in Settings.' }, { status: 400 });
  }

  const { id } = await params;
  const caseId = parseInt(id);

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from('email_cases')
    .select('id, customer_phone')
    .eq('id', caseId)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  const c = row as { id: number; customer_phone: string | null };
  const toNumber = parsed.data.to || c.customer_phone;
  if (!toNumber) {
    return NextResponse.json(
      { error: 'No customer phone on file. Provide a `to` field or add one to the case.' },
      { status: 400 },
    );
  }

  try {
    const result = await sendOutboundSms({
      caseId,
      toNumber,
      body: parsed.data.body,
      actor: 'admin',
    });
    log.info({ caseId, sid: result.twilioSid }, 'Outbound SMS queued');
    return NextResponse.json({
      success: true,
      twilio_sid: result.twilioSid,
      message_id: result.messageId,
      message: 'SMS queued with Twilio.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ caseId, err }, 'Failed to send outbound SMS');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
