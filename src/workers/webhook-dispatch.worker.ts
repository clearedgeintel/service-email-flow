import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES, WebhookDispatchJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { deliverWebhook } from '@/services/webhook.service';

const log = createChildLogger('webhook-dispatch');

export function startWebhookDispatchWorker() {
  return createWorker<WebhookDispatchJobData>(
    QUEUE_NAMES.WEBHOOK_DISPATCH,
    async (job: Job<WebhookDispatchJobData>) => {
      const { subscriptionId, eventType, caseId, payload } = job.data;
      const attempt = job.attemptsMade + 1;

      log.info({ subscriptionId, eventType, attempt }, 'Delivering webhook');

      const result = await deliverWebhook(subscriptionId, eventType, caseId, payload, attempt);

      if (!result.success) {
        // Throw to let BullMQ retry with exponential backoff (attempts: 4 per emit)
        throw new Error(`Webhook delivery failed: ${result.error || 'unknown'}`);
      }

      log.info({ subscriptionId, eventType, status: result.status }, 'Webhook delivered');
    },
    5, // concurrency — many subscriptions can deliver in parallel
  );
}
