import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { composeAndSendReply } from '@/services/composer.service';

const log = createChildLogger('composer');

export function startComposerWorker() {
  return createWorker<CaseJobData>(
    QUEUE_NAMES.COMPOSER,
    async (job: Job<CaseJobData>) => {
      const { caseId } = job.data;
      log.info({ caseId }, 'Composing customer reply...');

      await composeAndSendReply(caseId);
    },
    2, // concurrency
  );
}
