import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { findEligibleCases, sendFollowup, escalateMaxAttempts } from '@/services/followup.service';

const log = createChildLogger('followup');

export function startFollowupWorker() {
  return createWorker(
    QUEUE_NAMES.FOLLOWUP,
    async (_job: Job) => {
      log.info('Scanning for follow-up eligible cases...');

      // First, escalate any maxed-out cases
      const escalated = await escalateMaxAttempts();
      if (escalated > 0) {
        log.info({ count: escalated }, 'Escalated max-attempt cases to NEEDS_MANUAL_CALL');
      }

      // Then, send follow-ups for eligible cases
      const eligible = await findEligibleCases();

      if (eligible.length === 0) {
        log.debug('No cases eligible for follow-up');
        return;
      }

      log.info({ count: eligible.length }, 'Found eligible follow-up cases');

      for (const caseId of eligible) {
        try {
          await sendFollowup(caseId);
        } catch (err) {
          log.error({ caseId, err }, 'Failed to send follow-up');
        }
      }
    },
    1, // concurrency
  );
}
