import { getConfig } from './config';
import { logger } from './logger';

export async function sendSlackMessage(text: string): Promise<boolean> {
  const webhookUrl = await getConfig<string>('slack_webhook_url', '');

  if (!webhookUrl) {
    logger.warn('Slack webhook URL not configured — skipping notification');
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, 'Slack webhook returned non-OK status');
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to send Slack message');
    return false;
  }
}
