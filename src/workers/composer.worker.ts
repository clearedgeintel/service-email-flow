import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { composeAndSendReply } from '@/services/composer.service';

const log = createChildLogger('composer');

export interface ComposerJobData extends CaseJobData {
  bypassSlotCache?: boolean;
}

export function startComposerWorker() {
  return createWorker<ComposerJobData>(
    QUEUE_NAMES.COMPOSER,
    async (job: Job<ComposerJobData>) => {
      const { caseId, bypassSlotCache } = job.data;
      log.info({ caseId, bypassSlotCache }, 'Composing customer reply...');

      await composeAndSendReply(caseId, { bypassSlotCache });
    },
    2, // concurrency
  );
}
