import { Queue, Worker, Job } from 'bullmq';
import { getRedis } from './redis';
import { createChildLogger } from './logger';

// Queue names — one per workflow
export const QUEUE_NAMES = {
  GMAIL_INTAKE: 'gmail-intake',
  CLASSIFIER: 'classifier',
  ROUTER: 'router',
  COMPOSER: 'composer',
  NOTIFIER: 'notifier',
  FOLLOWUP: 'followup',
  DIGEST: 'digest',
  ERROR_ALERT: 'error-alert',
  WEBHOOK_DISPATCH: 'webhook-dispatch',
  SMS_AUTO_REPLY: 'sms-auto-reply',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Job data types
export interface CaseJobData {
  caseId: number;
}

export interface ErrorAlertJobData {
  queueName: string;
  jobId: string;
  errorMessage: string;
  timestamp: string;
}

export interface WebhookDispatchJobData {
  subscriptionId: number;
  eventType: string;
  caseId: number | null;
  payload: Record<string, unknown>;
}

const queues = new Map<string, Queue>();

/** Get or create a BullMQ Queue instance */
export function getQueue(name: QueueName): Queue {
  if (queues.has(name)) return queues.get(name)!;

  const queue = new Queue(name, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  queues.set(name, queue);
  return queue;
}

/** Create a BullMQ Worker with standard error handling */
export function createWorker<T = CaseJobData>(
  name: QueueName,
  processor: (job: Job<T>) => Promise<void>,
  concurrency = 1,
): Worker<T> {
  const log = createChildLogger(name);

  const worker = new Worker<T>(name, processor, {
    connection: getRedis(),
    concurrency,
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, `Job completed`);
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, `Job failed`);

    // Enqueue error alert
    if (job) {
      getQueue(QUEUE_NAMES.ERROR_ALERT).add('error', {
        queueName: name,
        jobId: job.id,
        errorMessage: err.message,
        timestamp: new Date().toISOString(),
      } as ErrorAlertJobData);
    }
  });

  worker.on('error', (err) => {
    log.error({ err: err.message }, `Worker error`);
  });

  return worker;
}

/** Set up repeatable (cron) jobs for time-based workers */
export async function setupRepeatableJobs(): Promise<void> {
  const gmailQueue = getQueue(QUEUE_NAMES.GMAIL_INTAKE);
  await gmailQueue.add('poll', {}, {
    repeat: { pattern: '*/2 * * * *' }, // Every 2 minutes
  });

  const followupQueue = getQueue(QUEUE_NAMES.FOLLOWUP);
  await followupQueue.add('scan', {}, {
    repeat: { pattern: '*/15 * * * *' }, // Every 15 minutes
  });

  const digestQueue = getQueue(QUEUE_NAMES.DIGEST);
  await digestQueue.add('daily', {}, {
    repeat: { pattern: '30 12 * * *' }, // Daily at 12:30 UTC (7:30 AM CT)
  });
}
