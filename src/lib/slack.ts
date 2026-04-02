import { getConfig } from './config';
import { logger } from './logger';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

export async function sendSlackMessage(text: string): Promise<boolean> {
  const webhookUrl = await getConfig<string>('slack_webhook_url', '');

  if (!webhookUrl) {
    logger.warn('Slack webhook URL not configured — skipping notification');
    return false;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        return true;
      }

      // Don't retry on client errors (4xx)
      if (res.status >= 400 && res.status < 500) {
        logger.error({ status: res.status }, 'Slack webhook returned client error — not retrying');
        return false;
      }

      logger.warn({ status: res.status, attempt }, 'Slack webhook returned server error — retrying');
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        logger.error({ err, attempts: attempt + 1 }, 'Failed to send Slack message after retries');
        return false;
      }
      logger.warn({ err, attempt }, 'Slack send failed — retrying');
    }

    // Wait before retry
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  return false;
}
