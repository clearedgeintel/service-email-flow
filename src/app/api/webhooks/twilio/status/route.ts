import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createChildLogger } from '@/lib/logger';
import {
  verifyTwilioSignature,
  processStatusCallback,
  isTwilioEnabled,
  getTwilioAuthToken,
} from '@/services/sms.service';

const log = createChildLogger('webhook-twilio-status');

/**
 * Twilio message status callback — fires for each transition on outbound
 * messages (queued → sent → delivered, or → failed). Configure the
 * statusCallback URL when creating messages, or set a default on the
 * Messaging Service.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const limited = rateLimit(`webhook-twilio-status:${ip}`, 240, 60_000);
  if (limited) return limited;

  const enabled = await isTwilioEnabled();
  if (!enabled) return NextResponse.json({ success: true, skipped: 'twilio_disabled' });

  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

  const authToken = await getTwilioAuthToken();
  if (authToken) {
    const signature = request.headers.get('x-twilio-signature') || '';
    if (!verifyTwilioSignature(authToken, signature, request.url, params)) {
      log.warn({ ip }, 'Twilio status callback signature failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  if (!params.MessageSid || !params.MessageStatus) {
    return NextResponse.json({ error: 'Missing MessageSid or MessageStatus' }, { status: 400 });
  }

  await processStatusCallback({
    MessageSid: params.MessageSid,
    MessageStatus: params.MessageStatus,
    ErrorCode: params.ErrorCode,
    ErrorMessage: params.ErrorMessage,
  });

  return NextResponse.json({ success: true });
}
