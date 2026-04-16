import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('cal-slots');

const CALCOM_API_BASE = 'https://api.cal.com/v2';
const CALCOM_API_VERSION = '2024-09-04';
const API_TIMEOUT_MS = 5000;

export interface SlotOption {
  iso: string;           // "2026-04-17T09:00:00.000-05:00"
  date_display: string;  // "Thu, Apr 17"
  time_display: string;  // "9:00 AM"
  booking_url: string;   // pre-filled Cal.com URL
}

interface FetchSlotsParams {
  apiKey: string;
  eventTypeId: number;
  calcomUrl: string;     // full base URL to the event type (e.g. https://cal.com/me/service)
  timezone: string;
  daysAhead: number;
  maxSlots: number;
}

// Simple in-memory cache so repeat calls within 5 min don't hammer Cal.com.
// Key: eventTypeId:daysAhead:timezone
interface CacheEntry {
  slots: SlotOption[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CalcomSlotsResponse {
  status: string;
  data: Record<string, string[]>;
}

/**
 * Fetch available slots from Cal.com and format them for email rendering.
 * Returns [] on any failure (graceful degradation to generic booking link).
 */
export async function fetchAvailableSlots(params: FetchSlotsParams): Promise<SlotOption[]> {
  const { apiKey, eventTypeId, calcomUrl, timezone, daysAhead, maxSlots } = params;

  if (!apiKey || !eventTypeId || eventTypeId <= 0) {
    return [];
  }

  const cacheKey = `${eventTypeId}:${daysAhead}:${timezone}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.slots.slice(0, maxSlots);
  }

  try {
    const now = new Date();
    // Start slightly in the future to avoid slots already passed
    const start = new Date(now.getTime() + 30 * 60 * 1000).toISOString().split('T')[0];
    const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const url = new URL(`${CALCOM_API_BASE}/slots`);
    url.searchParams.set('eventTypeId', String(eventTypeId));
    url.searchParams.set('start', start);
    url.searchParams.set('end', end);
    url.searchParams.set('timeZone', timezone);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'cal-api-version': CALCOM_API_VERSION,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      log.warn({ status: res.status, eventTypeId }, 'Cal.com /slots returned non-OK');
      return [];
    }

    const body = (await res.json()) as CalcomSlotsResponse;
    if (body.status !== 'success' || !body.data) {
      log.warn({ body }, 'Cal.com /slots unexpected response shape');
      return [];
    }

    const slots = flattenAndFormat(body.data, calcomUrl, timezone);
    cache.set(cacheKey, { slots, expiresAt: Date.now() + CACHE_TTL_MS });

    return slots.slice(0, maxSlots);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    log.warn({ err: isAbort ? 'timeout' : err, eventTypeId }, 'Failed to fetch Cal.com slots');
    return [];
  }
}

/** Flatten the date-keyed slot response into a chronological list of SlotOptions */
function flattenAndFormat(
  data: Record<string, string[]>,
  calcomUrl: string,
  timezone: string,
): SlotOption[] {
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const slots: SlotOption[] = [];
  const dates = Object.keys(data).sort();

  for (const date of dates) {
    for (const iso of data[date]) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) continue;

      slots.push({
        iso,
        date_display: dateFormatter.format(d),
        time_display: timeFormatter.format(d),
        booking_url: buildBookingUrl(calcomUrl, iso),
      });
    }
  }

  return slots;
}

/** Build a pre-filled Cal.com URL that auto-selects the given slot */
function buildBookingUrl(baseUrl: string, iso: string): string {
  const url = new URL(baseUrl);
  const datePart = iso.substring(0, 10); // YYYY-MM-DD
  const monthPart = iso.substring(0, 7);  // YYYY-MM
  url.searchParams.set('date', datePart);
  url.searchParams.set('month', monthPart);
  url.searchParams.set('slot', iso);
  return url.toString();
}

/** Clear the slot cache (for testing or manual invalidation) */
export function clearSlotCache(): void {
  cache.clear();
}

/** Render slots as a plain-text list for inclusion in LLM prompts */
export function slotsToPromptText(slots: SlotOption[]): string {
  if (slots.length === 0) return '';
  return slots.map((s) => `- ${s.date_display} at ${s.time_display}`).join('\n');
}
