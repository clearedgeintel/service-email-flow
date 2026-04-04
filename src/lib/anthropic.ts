import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  client = new Anthropic({
    apiKey,
    timeout: 30_000,
    maxRetries: 2,
  });
  return client;
}

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
}
