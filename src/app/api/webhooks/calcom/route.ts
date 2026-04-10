import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyCalcomSignature, processCalcomWebhook, CalcomWebhookPayload } from '@/services/calcom.service';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('webhook-calcom');

export async function POST(request: NextRequest) {
  // Rate limit: 60 requests per minute per IP
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const limited = rateLimit(`webhook-calcom:${ip}`, 60, 60_000);
  if (limited) return limited;

  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify signature if secret is configured
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (secret) {
    const signature = request.headers.get('x-cal-signature-256') || '';
    if (!verifyCalcomSignature(rawBody, signature, secret)) {
      log.warn({ ip }, 'Cal.com webhook signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let webhook: CalcomWebhookPayload;
  try {
    webhook = JSON.parse(rawBody) as CalcomWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!webhook.triggerEvent) {
    return NextResponse.json({ error: 'Missing triggerEvent' }, { status: 400 });
  }

  try {
    const result = await processCalcomWebhook(webhook);
    return NextResponse.json({
      success: true,
      handled: result.handled,
      case_id: result.caseId,
      reason: result.reason,
    });
  } catch (e) {
    log.error({ err: e, trigger: webhook.triggerEvent }, 'Failed to process Cal.com webhook');
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
