import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { sendDailyDigest } from '@/services/digest.service';

const log = createChildLogger('digest');

export function startDigestWorker() {
  return createWorker(
    QUEUE_NAMES.DIGEST,
    async (_job: Job) => {
      log.info('Generating daily digest...');
      await sendDailyDigest();
    },
    1, // concurrency
  );
}
