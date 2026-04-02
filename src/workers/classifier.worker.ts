import { Job } from 'bullmq';
import { createWorker, getQueue, QUEUE_NAMES, CaseJobData } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { classifyCase } from '@/services/classifier.service';
import { getSupabase } from '@/lib/supabase';
import { logCaseEvent } from '@/services/case-event.service';
import { EventType } from '@/types/events';

const log = createChildLogger('classifier');

export function startClassifierWorker() {
  return createWorker<CaseJobData>(
    QUEUE_NAMES.CLASSIFIER,
    async (job: Job<CaseJobData>) => {
      const { caseId } = job.data;
      const isLastAttempt = (job.attemptsMade + 1) >= (job.opts?.attempts ?? 3);

      log.info({ caseId, attempt: job.attemptsMade + 1 }, 'Classifying case...');

      try {
        const result = await classifyCase(caseId);

        // Only enqueue router if classification was valid (not NEEDS_REVIEW from low confidence)
        if (result.confidence >= 0.70) {
          const routerQueue = getQueue(QUEUE_NAMES.ROUTER);
          await routerQueue.add('route', { caseId } as CaseJobData);
          log.info({ caseId }, 'Enqueued router job');
        } else {
          log.info({ caseId, confidence: result.confidence }, 'Low confidence — skipping router');
        }
      } catch (err) {
        // On final attempt, gracefully degrade to NEEDS_REVIEW instead of leaving stuck
        if (isLastAttempt) {
          log.error({ caseId, err }, 'Classification failed on final attempt — routing to NEEDS_REVIEW');

          const supabase = getSupabase();
          await supabase
            .from('email_cases')
            .update({ status: 'NEEDS_REVIEW', notes: 'Classification failed after retries — needs manual review' })
            .eq('id', caseId);

          await logCaseEvent({
            caseId,
            eventType: EventType.ERROR,
            summary: `Classification failed after ${job.attemptsMade + 1} attempts — routed to NEEDS_REVIEW`,
            metadata: { error: err instanceof Error ? err.message : String(err) },
          });

          return; // Don't re-throw — let the job complete
        }

        throw err; // Re-throw for BullMQ retry
      }
    },
    3, // concurrency
  );
}
