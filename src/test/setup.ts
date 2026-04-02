import { vi, beforeEach } from 'vitest';

// Set required env vars so singleton factories don't throw on import
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_MODEL = 'gpt-4o';
process.env.GMAIL_CLIENT_ID = 'test-client-id';
process.env.GMAIL_CLIENT_SECRET = 'test-secret';
process.env.GMAIL_REFRESH_TOKEN = 'test-refresh';
process.env.GMAIL_SEND_AS = 'test@example.com';
process.env.TWILIO_ACCOUNT_SID = 'test-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.ADMIN_PASSWORD = 'test-password';

beforeEach(() => {
  vi.restoreAllMocks();
});
