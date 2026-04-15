import { Job } from 'bullmq';
import { createWorker, getQueue, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { fetchUnreadMessages, deduplicateAndStore } from '@/services/gmail-intake.service';
import { startPoll } from '@/services/poll-history.service';

const log = createChildLogger('gmail-intake');

export function startGmailIntakeWorker() {
  return createWorker(
    QUEUE_NAMES.GMAIL_INTAKE,
    async (job: Job) => {
      const poll = startPoll(QUEUE_NAMES.GMAIL_INTAKE);
      const trigger = (job.data as { trigger?: string } | undefined)?.trigger || 'scheduled';
      log.info({ trigger }, 'Polling Gmail for new messages...');

      try {
        const emails = await fetchUnreadMessages();

        if (emails.length === 0) {
          log.debug('No new messages');
          await poll.finish({ messagesFound: 0, casesInserted: 0, metadata: { trigger } });
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
          { fetched: emails.length, inserted: insertedIds.length, trigger },
          'Gmail intake cycle complete',
        );

        await poll.finish({
          messagesFound: emails.length,
          casesInserted: insertedIds.length,
          metadata: { trigger, inserted_ids: insertedIds },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await poll.finish({ error: errorMsg, metadata: { trigger } });
        throw err;
      }
    },
    1, // concurrency
  );
}
