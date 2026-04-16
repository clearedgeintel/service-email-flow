import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createChildLogger } from '@/lib/logger';
import {
  verifyRetellSignature,
  processRetellWebhook,
  buildInboundResponse,
  getRetellApiKey,
  isRetellEnabled,
  RetellWebhookPayload,
} from '@/services/retell.service';

const log = createChildLogger('webhook-retell');

export async function POST(request: NextRequest) {
  // Rate limit: 120 req/min (voice calls can be bursty on large accounts)
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const limited = rateLimit(`webhook-retell:${ip}`, 120, 60_000);
  if (limited) return limited;

  const enabled = await isRetellEnabled();
  if (!enabled) {
    // Still return 200 so Retell doesn't retry; just no-op
    return NextResponse.json({ success: true, skipped: 'retell_disabled' });
  }

  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify signature
  const apiKey = await getRetellApiKey();
  if (apiKey) {
    const signature = request.headers.get('x-retell-signature') || '';
    if (!(await verifyRetellSignature(rawBody, signature, apiKey))) {
      log.warn({ ip }, 'Retell webhook signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    log.warn('Retell webhook received but no API key configured — skipping verification');
  }

  let webhook: RetellWebhookPayload;
  try {
    webhook = JSON.parse(rawBody) as RetellWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!webhook.event) {
    return NextResponse.json({ error: 'Missing event' }, { status: 400 });
  }

  // call_inbound fires before Retell answers the call — Retell expects a
  // response containing dynamic_variables and optional override_agent_id.
  if (webhook.event === 'call_inbound') {
    try {
      const response = await buildInboundResponse(webhook.call_inbound?.from_number);
      log.info(
        { from: webhook.call_inbound?.from_number, override: response.call_inbound.override_agent_id },
        'Retell call_inbound handled',
      );
      return NextResponse.json(response);
    } catch (e) {
      log.error({ err: e }, 'Failed to build call_inbound response');
      // Return empty response so Retell falls back to default agent
      return NextResponse.json({ call_inbound: {} });
    }
  }

  if (!webhook.call?.call_id) {
    return NextResponse.json({ error: 'Missing call data' }, { status: 400 });
  }

  try {
    const result = await processRetellWebhook(webhook);
    return NextResponse.json({
      success: true,
      handled: result.handled,
      case_id: result.caseId,
      call_id: result.callId,
      action: result.action,
    });
  } catch (e) {
    log.error({ err: e, event: webhook.event }, 'Failed to process Retell webhook');
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
