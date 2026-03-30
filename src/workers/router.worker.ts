import { Job } from 'bullmq';
import { createWorker, getQueue, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { routeCase } from '@/services/router.service';

const log = createChildLogger('router');

export function startRouterWorker() {
  return createWorker<CaseJobData>(
    QUEUE_NAMES.ROUTER,
    async (job: Job<CaseJobData>) => {
      const { caseId } = job.data;
      log.info({ caseId }, 'Routing case...');

      const decision = await routeCase(caseId);

      // Enqueue downstream jobs based on routing decision
      if (decision.requiresCustomerReply) {
        const composerQueue = getQueue(QUEUE_NAMES.COMPOSER);
        await composerQueue.add('compose', { caseId } as CaseJobData);
        log.info({ caseId }, 'Enqueued composer job');
      }

      if (decision.requiresTechNotify) {
        const notifierQueue = getQueue(QUEUE_NAMES.NOTIFIER);
        await notifierQueue.add('notify', { caseId } as CaseJobData);
        log.info({ caseId }, 'Enqueued notifier job');
      }
    },
    3, // concurrency
  );
}
