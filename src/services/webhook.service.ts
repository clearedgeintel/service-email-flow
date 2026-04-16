import crypto from 'crypto';
import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('webhooks');

export const WEBHOOK_EVENT_TYPES = [
  'case.created',
  'case.classified',
  'case.routed',
  'case.escalated',
  'case.replied',
  'case.booked',
  'case.closed',
  'case.note_added',
  'call.started',
  'call.ended',
  'call.analyzed',
  'sms.received',
  'sms.sent',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookSubscription {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Emit a case event to all active subscriptions that are listening.
 * Fire-and-forget — enqueues BullMQ jobs for each matching subscription.
 * Never throws; webhook delivery is not supposed to block the main pipeline.
 */
export async function emitWebhookEvent(
  eventType: WebhookEventType,
  caseId: number | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = getSupabase();
    const { data: subs, error } = await supabase
      .from('webhook_subscriptions')
      .select('id, events')
      .eq('active', true);

    if (error || !subs) return;

    const matching = (subs as Array<{ id: number; events: string[] }>).filter(
      (s) => s.events.includes(eventType),
    );

    if (matching.length === 0) return;

    // Build the payload once
    const payload = {
      event: eventType,
      case_id: caseId,
      timestamp: new Date().toISOString(),
      data,
    };

    // Enqueue a dispatch job per matching subscription
    const { getQueue, QUEUE_NAMES } = await import('@/lib/queue');
    const queue = getQueue(QUEUE_NAMES.WEBHOOK_DISPATCH);
    await Promise.all(
      matching.map((sub) =>
        queue.add(
          'deliver',
          {
            subscriptionId: sub.id,
            eventType,
            caseId,
            payload,
          },
          {
            attempts: 4,
            backoff: { type: 'exponential', delay: 3000 },
          },
        ),
      ),
    );

    log.debug({ eventType, caseId, recipients: matching.length }, 'Webhook event emitted');
  } catch (err) {
    // Swallow errors so pipeline isn't disrupted. Individual delivery
    // failures will be recorded in webhook_deliveries.
    log.warn({ err, eventType, caseId }, 'emitWebhookEvent failed');
  }
}

/** Build HMAC-SHA256 signature for a webhook body, hex-encoded */
export function signPayload(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Generate a cryptographically-strong secret for new subscriptions */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Deliver a single webhook with retries handled by BullMQ.
 * Called by the webhook-dispatch worker. Returns the delivery status so
 * the worker can decide whether to throw (trigger retry) or resolve.
 */
export async function deliverWebhook(
  subscriptionId: number,
  eventType: string,
  caseId: number | null,
  payload: Record<string, unknown>,
  attempt: number,
): Promise<{ success: boolean; status: number | null; error: string | null }> {
  const supabase = getSupabase();

  // Fetch current subscription state (in case it was disabled after enqueueing)
  const { data: sub, error: fetchError } = await supabase
    .from('webhook_subscriptions')
    .select('id, url, secret, active')
    .eq('id', subscriptionId)
    .single();

  if (fetchError || !sub) {
    return { success: false, status: null, error: 'Subscription not found' };
  }

  const subscription = sub as { id: number; url: string; secret: string; active: boolean };

  if (!subscription.active) {
    // Subscription disabled while job was queued — skip silently
    return { success: true, status: null, error: null };
  }

  const rawBody = JSON.stringify(payload);
  const signature = signPayload(rawBody, subscription.secret);

  // Record the attempt
  const { data: delivery } = await supabase
    .from('webhook_deliveries')
    .insert({
      subscription_id: subscription.id,
      event_type: eventType,
      case_id: caseId,
      payload,
      attempt,
      status: 'pending',
    })
    .select('id')
    .single();

  const deliveryId = delivery ? (delivery as { id: number }).id : null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ClearDesk-Webhook/1.0',
        'X-ClearDesk-Event': eventType,
        'X-ClearDesk-Signature-256': signature,
        'X-ClearDesk-Delivery': deliveryId ? String(deliveryId) : 'unknown',
      },
      body: rawBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseBody = await res.text().catch(() => '');
    const truncatedBody = responseBody.substring(0, 2000);

    if (deliveryId) {
      await supabase
        .from('webhook_deliveries')
        .update({
          status: res.ok ? 'success' : 'failed',
          response_status: res.status,
          response_body: truncatedBody,
          completed_at: new Date().toISOString(),
        })
        .eq('id', deliveryId);
    }

    return { success: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const errorMsg = err instanceof Error
      ? (err.name === 'AbortError' ? 'Timeout after 10s' : err.message)
      : String(err);

    if (deliveryId) {
      await supabase
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          error: errorMsg,
          completed_at: new Date().toISOString(),
        })
        .eq('id', deliveryId);
    }

    return { success: false, status: null, error: errorMsg };
  }
}
