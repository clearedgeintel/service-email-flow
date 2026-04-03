/**
 * Shared email building utilities. Consolidates buildRawEmail / buildRawTextEmail
 * that were duplicated across composer, notifier, followup, and digest services.
 */

/** Strip HTML tags to produce a plain-text version of an HTML email body. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&bull;/g, '•')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  /** If provided, sends as multipart/alternative with both HTML and plain text */
  html?: string;
  /** Plain text body. Auto-generated from HTML if not provided. */
  text?: string;
  /** Reply-To header */
  replyTo?: string;
  /** Gmail thread ID to keep in same thread */
  threadId?: string;
}

/**
 * Build a RFC 2822 email encoded as URL-safe base64 for the Gmail API.
 * Includes List-Unsubscribe header and plain-text fallback for HTML emails.
 */
export function buildRawEmail(params: EmailParams): string {
  const { to, from, subject, replyTo } = params;
  const unsubscribeEmail = from || 'unsubscribe@example.com';

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `List-Unsubscribe: <mailto:${unsubscribeEmail}?subject=unsubscribe>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
  ];

  if (replyTo) {
    headers.push(`Reply-To: ${replyTo}`);
  }

  let body: string;

  if (params.html) {
    // Multipart: HTML + plain text fallback
    const plainText = params.text || htmlToPlainText(params.html);
    const boundary = `boundary_${Date.now()}`;

    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    body = [
      '',
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      '',
      Buffer.from(plainText).toString('base64'),
      '',
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      '',
      Buffer.from(params.html).toString('base64'),
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    // Plain text only
    const text = params.text || '';
    headers.push(`Content-Type: text/plain; charset="UTF-8"`);
    headers.push(`Content-Transfer-Encoding: base64`);
    body = '\r\n' + Buffer.from(text).toString('base64');
  }

  const raw = headers.join('\r\n') + '\r\n' + body;

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Check if the current time is within business hours.
 * Business hours: Monday-Friday, 7 AM - 7 PM in the configured timezone.
 */
export function isBusinessHours(timezone: string = 'America/Chicago'): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0');
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  return !isWeekend && hour >= 7 && hour < 19;
}

/**
 * Returns the next business hours start time.
 * Used to delay non-urgent replies until business hours.
 */
export function nextBusinessHoursStart(timezone: string = 'America/Chicago'): Date {
  const now = new Date();
  // Simple approach: try each hour forward until we hit business hours
  const candidate = new Date(now);
  for (let i = 0; i < 72; i++) {
    candidate.setHours(candidate.getHours() + 1);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    const parts = formatter.formatToParts(candidate);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0');
    const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
    const isWeekend = weekday === 'Sat' || weekday === 'Sun';

    if (!isWeekend && hour >= 7 && hour < 19) {
      return candidate;
    }
  }
  return now; // Fallback: send now
}
