import twilio from 'twilio';
import type { Twilio } from 'twilio';

let client: Twilio | null = null;

export function getTwilio(): Twilio {
  if (client) return client;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variables');
  }

  client = twilio(accountSid, authToken);
  return client;
}

export function getTwilioFromNumber(): string {
  return process.env.TWILIO_FROM_NUMBER || '';
}
