import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';
import { fetchAvailableSlots } from '../cal-slots.service';
import { CalendarEvent, CalendarProvider, FreeSlot } from './types';

const log = createChildLogger('calendar-calcom');

const API_BASE = 'https://api.cal.com/v2';
const API_VERSION = '2024-08-13';
const TIMEOUT_MS = 8000;

async function getCredentials(): Promise<{ apiKey: string; defaultEventTypeId: number; calcomUrl: string; timezone: string } | null> {
  const [apiKey, eventTypeIdRaw, calcomUrl, timezone] = await Promise.all([
    getConfig<string>('calcom_api_key', ''),
    getConfig<unknown>('calcom_event_type_service', ''),
    getConfig<string>('calcom_service_url', ''),
    getConfig<string>('business_timezone', 'America/New_York'),
  ]);

  if (!apiKey) return null;
  const defaultEventTypeId = Number(eventTypeIdRaw) || 0;
  return { apiKey, defaultEventTypeId, calcomUrl, timezone };
}

/**
 * Cal.com provider — live fetches from the Cal.com API:
 *   - listEvents: booked appointments on the admin's Cal.com calendar
 *   - listFreeSlots: available slots for the configured event type
 *
 * Both calls are live per-render. If that becomes a perf issue, Phase 11.4
 * introduces a local calendar_events cache with incremental sync.
 */
export const calComProvider: CalendarProvider = {
  id: 'calcom',
  label: 'Cal.com',

  async isConfigured() {
    const creds = await getCredentials();
    return !!creds?.apiKey;
  },

  async listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
    const creds = await getCredentials();
    if (!creds) return [];

    try {
      const url = new URL(`${API_BASE}/bookings`);
      url.searchParams.set('afterStart', from.toISOString());
      url.searchParams.set('beforeEnd', to.toISOString());
      url.searchParams.set('take', '250');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          'cal-api-version': API_VERSION,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        log.warn({ status: res.status }, 'Cal.com /bookings returned non-OK');
        return [];
      }

      const body = (await res.json()) as { status?: string; data?: Array<Record<string, unknown>> };
      const bookings = body.data || [];

      return bookings
        .map((b): CalendarEvent | null => {
          const id = String(b.uid ?? b.id ?? '');
          const start = typeof b.start === 'string' ? b.start : null;
          const end = typeof b.end === 'string' ? b.end : null;
          if (!id || !start || !end) return null;

          const attendees = Array.isArray(b.attendees) ? (b.attendees as Array<Record<string, unknown>>) : [];
          const attendeeName = attendees[0]?.name as string | undefined;
          const title = (b.title as string) || attendeeName || 'Cal.com booking';

          return {
            id: `calcom:${id}`,
            provider: 'calcom',
            title,
            start,
            end,
            href: typeof b.meetingUrl === 'string' ? (b.meetingUrl as string) : undefined,
            status: (b.status as string) || 'booked',
            metadata: {
              attendees: attendees.map((a) => ({ name: a.name, email: a.email })),
            },
          };
        })
        .filter((e): e is CalendarEvent => e !== null);
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      log.warn({ err: isAbort ? 'timeout' : err }, 'Failed to fetch Cal.com bookings');
      return [];
    }
  },

  async listFreeSlots(from: Date, to: Date, eventTypeId?: string): Promise<FreeSlot[]> {
    const creds = await getCredentials();
    if (!creds) return [];

    const typeId = Number(eventTypeId) || creds.defaultEventTypeId;
    if (!typeId) return [];

    const msDay = 24 * 60 * 60 * 1000;
    const daysAhead = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / msDay));

    const slots = await fetchAvailableSlots({
      apiKey: creds.apiKey,
      eventTypeId: typeId,
      calcomUrl: creds.calcomUrl,
      timezone: creds.timezone,
      daysAhead,
      maxSlots: 200,
    });

    return slots
      .filter((s) => {
        const t = new Date(s.iso).getTime();
        return t >= from.getTime() && t <= to.getTime();
      })
      .map((s) => ({
        provider: 'calcom' as const,
        start: s.iso,
        // Cal.com slot durations aren't returned from /slots; approximate via eventType when needed.
        // For the calendar UI we render 30-minute default blocks.
        end: new Date(new Date(s.iso).getTime() + 30 * 60_000).toISOString(),
        bookingUrl: s.booking_url,
      }));
  },
};
