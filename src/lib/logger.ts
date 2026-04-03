import pino from 'pino';
import crypto from 'crypto';

/** Mask email addresses: john@example.com → jo***@example.com */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return user.substring(0, 2) + '***@' + domain;
}

/** Mask phone numbers: +15551234567 → +1555***4567 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return phone.substring(0, phone.length - 7) + '***' + phone.substring(phone.length - 4);
}

/** Recursively mask PII in log objects */
function maskPii(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Mask email patterns
    return obj.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => maskEmail(match));
  }
  if (Array.isArray(obj)) {
    return obj.map(maskPii);
  }
  if (obj && typeof obj === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes('email') && typeof value === 'string' && value.includes('@')) {
        masked[key] = maskEmail(value);
      } else if (keyLower.includes('phone') && typeof value === 'string') {
        masked[key] = maskPhone(value);
      } else {
        masked[key] = maskPii(value);
      }
    }
    return masked;
  }
  return obj;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    log(obj) {
      return maskPii(obj) as Record<string, unknown>;
    },
  },
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ worker: name });
}

/** Generate a unique correlation ID for tracing a request or job across services */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/** Create a child logger with a correlation ID bound */
export function createCorrelatedLogger(name: string, correlationId?: string) {
  const corrId = correlationId || generateCorrelationId();
  return {
    logger: logger.child({ worker: name, correlationId: corrId }),
    correlationId: corrId,
  };
}
