import { google, calendar_v3 } from 'googleapis';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';
import { CalendarEvent, CalendarProvider } from './types';

const log = createChildLogger('calendar-google');

/**
 * Google Calendar (read-only) provider. Overlays the admin's personal
 * calendar onto the ClearDesk calendar view as "busy blocks" so conflicts
 * between ClearDesk bookings and the admin's own schedule are obvious.
 *
 * Reuses the Gmail OAuth client (same Google Cloud project), but requires a
 * separate refresh token minted with the calendar.readonly scope — Gmail
 * tokens don't carry that scope by default. See docs/GOOGLE_CALENDAR_SETUP.md.
 *
 * No slot booking — `listFreeSlots` is intentionally omitted.
 */

let cached: calendar_v3.Calendar | null = null;

/** Reset the cached client. Used by tests; real runtime resets on restart. */
export function resetGoogleCalendarClient(): void {
  cached = null;
}

function getClient(): calendar_v3.Calendar | null {
  if (cached) return cached;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  cached = google.calendar({ version: 'v3', auth });
  return cached;
}

/** Drop events that shouldn't count as busy time. */
function keepBusy(e: calendar_v3.Schema$Event): boolean {
  if (e.status === 'cancelled') return false;
  if (e.transparency === 'transparent') return false; // marked as Available
  const self = e.attendees?.find((a) => a.self === true);
  if (self && self.responseStatus === 'declined') return false;
  return true;
}

function extractStart(e: calendar_v3.Schema$Event): { iso: string; allDay: boolean } | null {
  if (e.start?.dateTime) return { iso: e.start.dateTime, allDay: false };
  if (e.start?.date) return { iso: `${e.start.date}T00:00:00Z`, allDay: true };
  return null;
}

function extractEnd(e: calendar_v3.Schema$Event, fallback: string): string {
  if (e.end?.dateTime) return e.end.dateTime;
  if (e.end?.date) return `${e.end.date}T00:00:00Z`;
  return fallback;
}

function toCalendarEvent(e: calendar_v3.Schema$Event, showTitles: boolean): CalendarEvent | null {
  const start = extractStart(e);
  if (!start) return null;
  const id = String(e.id ?? '');
  if (!id) return null;
  const end = extractEnd(e, start.iso);

  return {
    id: `google:${id}`,
    provider: 'google',
    title: showTitles ? (e.summary || 'Busy') : 'Busy',
    start: start.iso,
    end,
    href: e.htmlLink ?? undefined,
    status: e.status ?? 'busy',
    metadata: {
      all_day: start.allDay,
      recurring_event_id: e.recurringEventId ?? null,
      organizer: e.organizer?.email ?? null,
    },
  };
}

export const googleCalendarProvider: CalendarProvider = {
  id: 'google',
  label: 'Google Calendar',

  async isConfigured() {
    const enabled = await getConfig<unknown>('google_calendar_enabled', false);
    if (!(enabled === true || enabled === 'true')) return false;
    return !!getClient();
  },

  async listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
    const cal = getClient();
    if (!cal) return [];

    const [calendarIdRaw, showTitlesRaw] = await Promise.all([
      getConfig<string>('google_calendar_id', 'primary'),
      getConfig<unknown>('google_calendar_show_titles', true),
    ]);
    const calendarId = calendarIdRaw?.trim() || 'primary';
    const showTitles = showTitlesRaw === true || showTitlesRaw === 'true';

    try {
      const items: calendar_v3.Schema$Event[] = [];
      let pageToken: string | undefined;
      do {
        const res = await cal.events.list({
          calendarId,
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: true,     // expand recurring into concrete instances
          orderBy: 'startTime',
          maxResults: 250,
          showDeleted: false,
          pageToken,
        });
        items.push(...(res.data.items ?? []));
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken && items.length < 1000);

      const events: CalendarEvent[] = [];
      for (const item of items) {
        if (!keepBusy(item)) continue;
        const mapped = toCalendarEvent(item, showTitles);
        if (mapped) events.push(mapped);
      }
      return events;
    } catch (err) {
      log.warn({ err, calendarId }, 'Google Calendar events.list failed');
      return [];
    }
  },
};
