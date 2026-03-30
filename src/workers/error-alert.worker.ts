import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES, ErrorAlertJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { sendErrorAlert } from '@/services/digest.service';

const log = createChildLogger('error-alert');

export function startErrorAlertWorker() {
  return createWorker<ErrorAlertJobData>(
    QUEUE_NAMES.ERROR_ALERT,
    async (job: Job<ErrorAlertJobData>) => {
      log.warn({ data: job.data }, 'Processing error alert...');
      await sendErrorAlert(job.data);
    },
    1, // concurrency
  );
}
