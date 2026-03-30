import { Job } from 'bullmq';
import { createWorker, getQueue, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { fetchUnreadMessages, deduplicateAndStore } from '@/services/gmail-intake.service';

const log = createChildLogger('gmail-intake');

export function startGmailIntakeWorker() {
  return createWorker(
    QUEUE_NAMES.GMAIL_INTAKE,
    async (_job: Job) => {
      log.info('Polling Gmail for new messages...');

      const emails = await fetchUnreadMessages();

      if (emails.length === 0) {
        log.debug('No new messages');
        return;
      }

      log.info({ count: emails.length }, 'Fetched new messages');

      const insertedIds = await deduplicateAndStore(emails);

      // Enqueue classifier jobs for each new case
      if (insertedIds.length > 0) {
        const classifierQueue = getQueue(QUEUE_NAMES.CLASSIFIER);

        for (const caseId of insertedIds) {
          await classifierQueue.add('classify', { caseId } as CaseJobData, {
            priority: 1, // Will be overridden by router based on urgency
          });
          log.info({ caseId }, 'Enqueued classifier job');
        }
      }

      log.info(
        { fetched: emails.length, inserted: insertedIds.length },
        'Gmail intake cycle complete',
      );
    },
    1, // concurrency
  );
}
