import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServer } from 'http';
import { setupRepeatableJobs } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { startGmailIntakeWorker } from './gmail-intake.worker';
import { startClassifierWorker } from './classifier.worker';
import { startRouterWorker } from './router.worker';
import { startComposerWorker } from './composer.worker';
import { startNotifierWorker } from './notifier.worker';
import { startFollowupWorker } from './followup.worker';
import { startDigestWorker } from './digest.worker';
import { startErrorAlertWorker } from './error-alert.worker';
import { startWebhookDispatchWorker } from './webhook-dispatch.worker';

const workers: Array<{ close: () => Promise<void> }> = [];
const startedAt = new Date().toISOString();

async function main() {
  logger.info('Starting ClearDesk workers...');

  // Set up repeatable (cron) jobs
  await setupRepeatableJobs();
  logger.info('Repeatable jobs configured');

  // Start all workers
  workers.push(startGmailIntakeWorker());
  workers.push(startClassifierWorker());
  workers.push(startRouterWorker());
  workers.push(startComposerWorker());
  workers.push(startNotifierWorker());
  workers.push(startFollowupWorker());
  workers.push(startDigestWorker());
  workers.push(startErrorAlertWorker());
  workers.push(startWebhookDispatchWorker());

  logger.info(`All workers started (${workers.length} active)`);

  // Tiny HTTP server so Railway/k8s healthchecks pass. The worker has no
  // public surface — only /api/health responds.
  const port = parseInt(process.env.PORT || '8080');
  const server = createServer((req, res) => {
    if (req.url === '/api/health' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        role: 'worker',
        workers_active: workers.length,
        started_at: startedAt,
        uptime_seconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  server.listen(port, () => {
    logger.info({ port }, 'Worker health endpoint listening');
  });
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
