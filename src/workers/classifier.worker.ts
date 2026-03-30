import { Job } from 'bullmq';
import { createWorker, getQueue, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { classifyCase } from '@/services/classifier.service';

const log = createChildLogger('classifier');

export function startClassifierWorker() {
  return createWorker<CaseJobData>(
    QUEUE_NAMES.CLASSIFIER,
    async (job: Job<CaseJobData>) => {
      const { caseId } = job.data;
      log.info({ caseId }, 'Classifying case...');

      const result = await classifyCase(caseId);

      // Only enqueue router if classification was valid (not NEEDS_REVIEW from low confidence)
      if (result.confidence >= 0.70) {
        const routerQueue = getQueue(QUEUE_NAMES.ROUTER);
        await routerQueue.add('route', { caseId } as CaseJobData);
        log.info({ caseId }, 'Enqueued router job');
      } else {
        log.info({ caseId, confidence: result.confidence }, 'Low confidence — skipping router');
      }
    },
    3, // concurrency
  );
}
