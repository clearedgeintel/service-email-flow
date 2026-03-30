import { setupRepeatableJobs } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { startGmailIntakeWorker } from './gmail-intake.worker';
import { startClassifierWorker } from './classifier.worker';
import { startRouterWorker } from './router.worker';
import { startComposerWorker } from './composer.worker';

const workers: Array<{ close: () => Promise<void> }> = [];

async function main() {
  logger.info('Starting ServiceFlow workers...');

  // Set up repeatable (cron) jobs
  await setupRepeatableJobs();
  logger.info('Repeatable jobs configured');

  // Start workers — pipeline order
  workers.push(startGmailIntakeWorker());
  workers.push(startClassifierWorker());
  workers.push(startRouterWorker());
  workers.push(startComposerWorker());
  logger.info('Pipeline workers started (intake → classify → route → compose)');

  // Phase 4 workers will be added here:
  // workers.push(startNotifierWorker());
  // workers.push(startFollowupWorker());
  // workers.push(startDigestWorker());
  // workers.push(startErrorAlertWorker());

  logger.info(`All workers started (${workers.length} active)`);
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down workers...');

  await Promise.all(workers.map((w) => w.close()));

  logger.info('All workers stopped');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  logger.fatal({ err }, 'Worker bootstrap failed');
  process.exit(1);
});
