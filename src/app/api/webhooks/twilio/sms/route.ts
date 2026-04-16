import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createChildLogger } from '@/lib/logger';
import {
  verifyTwilioSignature,
  processInboundSms,
  isTwilioEnabled,
  getTwilioAuthToken,
  TwilioInboundParams,
} from '@/services/sms.service';

const log = createChildLogger('webhook-twilio-sms');

/**
 * Twilio sends inbound SMS as application/x-www-form-urlencoded and
 * expects TwiML (or an empty 200) in response. We reply with an empty
 * <Response/> so Twilio treats it as acknowledged without auto-replying.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const limited = rateLimit(`webhook-twilio-sms:${ip}`, 120, 60_000);
  if (limited) return limited;

  const enabled = await isTwilioEnabled();
  if (!enabled) {
    // Still 200 so Twilio doesn't retry, but do nothing
    return new NextResponse('<Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as TwilioInboundParams;

  // Verify signature. Twilio signs the FULL webhook URL + sorted form params.
  const authToken = await getTwilioAuthToken();
  if (authToken) {
    const signature = request.headers.get('x-twilio-signature') || '';
    const url = request.url;
    const flatParams = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v ?? '')]),
    );
    if (!verifyTwilioSignature(authToken, signature, url, flatParams)) {
      log.warn({ ip }, 'Twilio SMS signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    log.warn('Twilio SMS webhook received but no auth token configured — skipping verification');
  }

  if (!params.MessageSid || !params.From) {
    return NextResponse.json({ error: 'Missing MessageSid or From' }, { status: 400 });
  }

  try {
    const result = await processInboundSms(params);
    log.info(
      { sid: params.MessageSid, caseId: result.caseId, from: params.From },
      'Inbound SMS handled',
    );
  } catch (err) {
    log.error({ err, sid: params.MessageSid }, 'Failed to process inbound SMS');
    // Still return 200 so Twilio doesn't retry a message that already partially persisted.
  }

  return new NextResponse('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
