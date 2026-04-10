import { getGmail, parseFromHeader, normalizeEmailBody } from '@/lib/gmail';
import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';
import { sanitizeHtml } from '@/lib/sanitize';
import { logCaseEvent } from './case-event.service';
import { EventType, NormalizedEmail } from '@/types';

const log = createChildLogger('gmail-intake');

/** Fetch unread messages from Gmail inbox, filtering out promotions/social/noreply */
export async function fetchUnreadMessages(): Promise<NormalizedEmail[]> {
  const gmail = getGmail();

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread -category:promotions -category:social -from:noreply -from:no-reply -from:mailer-daemon',
    labelIds: ['INBOX'],
    maxResults: 10,
  });

  const messageIds = res.data.messages || [];
  if (messageIds.length === 0) {
    return [];
  }

  const emails: NormalizedEmail[] = [];

  for (const msg of messageIds) {
    if (!msg.id) continue;

    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = full.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      const fromRaw = getHeader('from');
      const { name: fromName, email: fromEmail } = parseFromHeader(fromRaw);
      const subject = getHeader('subject') || '(no subject)';

      // Extract and sanitize body
      const bodyRaw = sanitizeHtml(extractBody(full.data.payload));
      const bodyCleaned = normalizeEmailBody(bodyRaw);

      // Check for attachments
      const hasAttachments = checkAttachments(full.data.payload);

      emails.push({
        gmail_message_id: msg.id,
        gmail_thread_id: full.data.threadId || msg.id,
        from_email: fromEmail,
        from_name: fromName || null,
        subject,
        body_raw: bodyRaw.substring(0, 10000),
        body_cleaned: bodyCleaned.substring(0, 5000),
        snippet: (full.data.snippet || '').substring(0, 500),
        has_attachments: hasAttachments,
        received_at: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ messageId: msg.id, err }, 'Failed to fetch message');
    }
  }

  return emails;
}

/** Recursively extract plain text body from Gmail payload */
function extractBody(payload: any): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!payload) return '(empty message body)';

  // Direct body data
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Multipart — recurse into parts
  if (payload.parts && Array.isArray(payload.parts)) {
    // Prefer text/plain over text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    // Fall back to text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result !== '(empty message body)') return result;
    }
  }

  // Single-part HTML fallback
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  return '(empty message body)';
}

/** Check if any parts have filenames (attachments) */
function checkAttachments(payload: any): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!payload) return false;
  if (payload.filename && payload.filename.length > 0) return true;
  if (payload.parts) {
    return payload.parts.some((p: any) => checkAttachments(p)); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return false;
}

/** Deduplicate and store emails. Returns IDs of newly inserted cases. */
export async function deduplicateAndStore(emails: NormalizedEmail[]): Promise<number[]> {
  const supabase = getSupabase();
  const insertedIds: number[] = [];

  for (const email of emails) {
    // Check for duplicate
    const { data: existing } = await supabase
      .from('email_cases')
      .select('id')
      .eq('gmail_message_id', email.gmail_message_id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      log.debug({ messageId: email.gmail_message_id }, 'Duplicate — skipping');
      // Still mark as read
      await markAsRead(email.gmail_message_id);
      continue;
    }

    // Insert new case
    const { data: inserted, error } = await supabase
      .from('email_cases')
      .insert({
        gmail_message_id: email.gmail_message_id,
        gmail_thread_id: email.gmail_thread_id,
        from_email: email.from_email,
        from_name: email.from_name,
        subject: email.subject,
        body_raw: email.body_raw,
        body_cleaned: email.body_cleaned,
        snippet: email.snippet,
        has_attachments: email.has_attachments,
        status: 'RECEIVED',
        customer_email: email.from_email,
        received_at: email.received_at,
      })
      .select('id')
      .single();

    if (error) {
      // ON CONFLICT DO NOTHING scenario
      if (error.code === '23505') {
        log.debug({ messageId: email.gmail_message_id }, 'Duplicate (constraint) — skipping');
        await markAsRead(email.gmail_message_id);
        continue;
      }
      log.error({ error, messageId: email.gmail_message_id }, 'Failed to insert case');
      continue;
    }

    if (inserted) {
      insertedIds.push(inserted.id);

      // Log event
      await logCaseEvent({
        caseId: inserted.id,
        eventType: EventType.RECEIVED,
        summary: `Email received from ${maskEmail(email.from_email)} — "${(email.subject || '').substring(0, 60)}"`,
        metadata: {
          from_email: maskEmail(email.from_email),
          subject: email.subject,
          has_attachments: email.has_attachments,
        },
      });

      // Sync Gmail label and mark as read
      const { syncMessageLabel } = await import('@/lib/gmail-labels');
      await syncMessageLabel(email.gmail_message_id, 'RECEIVED');
      await markAsRead(email.gmail_message_id);

      log.info(
        { caseId: inserted.id, from: maskEmail(email.from_email) },
        'New case ingested',
      );
    }
  }

  return insertedIds;
}

async function markAsRead(messageId: string): Promise<void> {
  try {
    const gmail = getGmail();
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  } catch (err) {
    log.warn({ messageId, err }, 'Failed to mark message as read');
  }
}

function maskEmail(email: string): string {
  if (!email) return 'n/a';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return user.substring(0, 2) + '***@' + domain;
}
