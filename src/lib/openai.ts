import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }

  client = new OpenAI({
    apiKey,
    timeout: 30_000, // 30 second timeout
    maxRetries: 2,   // SDK-level retries on transient errors
  });
  return client;
}

export function getModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-4o';
}
