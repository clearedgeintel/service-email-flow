import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { notifyTech } from '@/services/notifier.service';

const log = createChildLogger('notifier');

export function startNotifierWorker() {
  return createWorker<CaseJobData>(
    QUEUE_NAMES.NOTIFIER,
    async (job: Job<CaseJobData>) => {
      const { caseId } = job.data;
      log.info({ caseId }, 'Sending tech notification...');

      await notifyTech(caseId);
    },
    2, // concurrency
  );
}
