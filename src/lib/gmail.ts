import { google, gmail_v1 } from 'googleapis';

let gmailClient: gmail_v1.Gmail | null = null;

export function getGmail(): gmail_v1.Gmail {
  if (gmailClient) return gmailClient;

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Gmail OAuth2 environment variables (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
  return gmailClient;
}

/** Parse "Display Name <email@domain.com>" format */
export function parseFromHeader(from: string): { name: string; email: string } {
  const angleMatch = from.match(/^"?(.+?)"?\s*<(.+?)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].replace(/"/g, '').trim(),
      email: angleMatch[2].trim().toLowerCase(),
    };
  }

  const parenMatch = from.match(/^(\S+@\S+)\s*\((.+?)\)$/);
  if (parenMatch) {
    return {
      name: parenMatch[2].trim(),
      email: parenMatch[1].trim().toLowerCase(),
    };
  }

  if (from.includes('@')) {
    return {
      name: from.split('@')[0],
      email: from.toLowerCase().trim(),
    };
  }

  return { name: from, email: '' };
}

/** Strip HTML tags, quoted replies, and signatures from email body */
export function normalizeEmailBody(raw: string): string {
  // Strip HTML
  let cleaned = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove quoted replies
  const quotePatterns = [
    /On .{10,80} wrote:[\s\S]*/i,
    /-----\s*Original Message\s*-----[\s\S]*/i,
    /From:.*?Sent:.*?To:.*?Subject:[\s\S]*/i,
    /_{3,}[\s\S]*$/,
    />{2,}[\s\S]*/,
    /\[image:.*?\]/g,
    /\[cid:.*?\]/g,
  ];
  for (const pat of quotePatterns) {
    cleaned = cleaned.replace(pat, '').trim();
  }

  // Remove signatures
  const sigPatterns = [
    /--\s*\n[\s\S]{0,500}$/,
    /Sent from my (?:iPhone|iPad|Galaxy|Android|Outlook|Mail|BlackBerry)[\s\S]*$/i,
    /Get Outlook for [\s\S]*$/i,
    /Best regards,[\s\S]{0,300}$/i,
    /Kind regards,[\s\S]{0,300}$/i,
    /Warm regards,[\s\S]{0,300}$/i,
    /Thanks,[\s\S]{0,300}$/i,
    /Thank you,[\s\S]{0,300}$/i,
    /Sincerely,[\s\S]{0,300}$/i,
    /Regards,[\s\S]{0,200}$/i,
    /Cheers,[\s\S]{0,200}$/i,
  ];
  for (const pat of sigPatterns) {
    cleaned = cleaned.replace(pat, '').trim();
  }

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}
