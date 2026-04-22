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
  /**
   * Minimum lead time in minutes — slots closer than this to "now" get
   * filtered out as insufficient runway. Defaults to 30. Set to 0 to
   * offer the literal next-available slot (handy for demo/test).
   */
  minLeadMinutes?: number;
  /**
   * Skip the 5-minute in-memory cache. Use for admin-triggered resends
   * where the previous run produced an empty result and the admin has
   * just corrected config — without this, the stale empty result sticks
   * around until TTL expires. Cache is also rewritten with the fresh
   * result so subsequent calls benefit.
   */
  bypassCache?: boolean;
}

// Simple in-memory cache so repeat calls within 5 min don't hammer Cal.com.
// Key: eventTypeId:daysAhead:timezone
interface CacheEntry {
  slots: SlotOption[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Cal.com /v2/slots can return two shapes inside each date bucket depending
 * on API version + event type config:
 *   - "2024-09-04"+: array of objects { start: ISO, attendeesCount?: number }
 *   - older: array of plain ISO strings
 * Our parser accepts both.
 */
type CalcomSlotEntry = string | { start?: string; time?: string; attendeesCount?: number };

interface CalcomSlotsResponse {
  status: string;
  data: Record<string, CalcomSlotEntry[]>;
}

/**
 * Fetch available slots from Cal.com and format them for email rendering.
 * Returns [] on any failure (graceful degradation to generic booking link).
 */
export async function fetchAvailableSlots(params: FetchSlotsParams): Promise<SlotOption[]> {
  const { apiKey, eventTypeId, calcomUrl, timezone, daysAhead, maxSlots, bypassCache } = params;
  const minLeadMinutes = typeof params.minLeadMinutes === 'number' ? params.minLeadMinutes : 30;

  if (!apiKey || !eventTypeId || eventTypeId <= 0) {
    return [];
  }

  const cacheKey = `${eventTypeId}:${daysAhead}:${timezone}:${minLeadMinutes}`;
  if (!bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.slots.slice(0, maxSlots);
    }
  } else {
    // Drop any stale entry so a concurrent non-bypass call gets the fresh
    // result once we populate below.
    cache.delete(cacheKey);
  }

  try {
    const now = new Date();
    // Compute start/end dates in the business timezone. Previously we used
    // UTC dates via toISOString().split('T'), which rolled to "tomorrow"
    // during late-evening Central Time and made today's remaining slots
    // invisible. Cal.com interprets YYYY-MM-DD in the provided timeZone.
    const start = formatDateInTimezone(now, timezone);
    const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const end = formatDateInTimezone(endDate, timezone);

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

    // Filter out slots that have already passed or are within the
    // configured lead-time window (not enough runway for a tech to prep).
    // This replaces the old "add 30 min to start date" buffer which never
    // worked because the start param is a date, not a time. The lead
    // window is configurable — default 30 min, set to 0 for demo/test
    // where next-immediate availability should qualify.
    const cutoff = Date.now() + Math.max(0, minLeadMinutes) * 60 * 1000;
    const allSlots = flattenAndFormat(body.data, calcomUrl, timezone);
    const slots = allSlots.filter((s) => {
      const t = new Date(s.iso).getTime();
      return !isNaN(t) && t >= cutoff;
    });

    cache.set(cacheKey, { slots, expiresAt: Date.now() + CACHE_TTL_MS });

    return slots.slice(0, maxSlots);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    log.warn({ err: isAbort ? 'timeout' : err, eventTypeId }, 'Failed to fetch Cal.com slots');
    return [];
  }
}

/** Flatten the date-keyed slot response into a chronological list of SlotOptions */
/** Extract the ISO timestamp from either Cal.com slot shape. */
function extractSlotIso(entry: CalcomSlotEntry): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    if (typeof entry.start === 'string') return entry.start;
    if (typeof entry.time === 'string') return entry.time;
  }
  return null;
}

function flattenAndFormat(
  data: Record<string, CalcomSlotEntry[]>,
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

  const todayInTz = formatDateInTimezone(new Date(), timezone);
  const tomorrowInTz = formatDateInTimezone(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
    timezone,
  );

  for (const date of dates) {
    for (const entry of data[date]) {
      const iso = extractSlotIso(entry);
      if (!iso) continue;
      const d = new Date(iso);
      if (isNaN(d.getTime())) continue;

      // Replace the weekday label with "Today" / "Tomorrow" when applicable
      // so urgency=TODAY customers see same-day options unambiguously.
      const slotDate = formatDateInTimezone(d, timezone);
      let dateDisplay = dateFormatter.format(d);
      if (slotDate === todayInTz) dateDisplay = `Today, ${dateFormatter.format(d).replace(/^\w+,\s*/, '')}`;
      else if (slotDate === tomorrowInTz) dateDisplay = `Tomorrow, ${dateFormatter.format(d).replace(/^\w+,\s*/, '')}`;

      slots.push({
        iso,
        date_display: dateDisplay,
        time_display: timeFormatter.format(d),
        booking_url: buildBookingUrl(calcomUrl, iso),
      });
    }
  }

  return slots;
}

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone. Cal.com's /slots
 * start/end params are interpreted in the provided timeZone — if we pass a
 * UTC date that's already rolled to tomorrow locally, today's slots get
 * skipped entirely.
 */
function formatDateInTimezone(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA locale produces YYYY-MM-DD directly
  return fmt.format(d);
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

export interface RawCalcomProbeResult {
  request: {
    url: string;             // with eventTypeId, start, end, timeZone — no auth
    method: 'GET';
    headers: Record<string, string>; // Authorization redacted to "Bearer ***"
  };
  response: {
    ok: boolean;
    status: number | null;   // null if network/abort
    error?: string;
    body: unknown;           // parsed JSON body, or raw text if JSON parse fails
  };
  /** Count of slot ISOs across all date buckets in a standard Cal.com response */
  slot_count_returned?: number;
  /** The YYYY-MM-DD start and end the request used, post-timezone fix */
  computed_start: string;
  computed_end: string;
}

/**
 * Make a single live call to Cal.com /slots and return the raw request +
 * response for debugging. Skips cache entirely. Used by the slot-diagnostic
 * endpoint when ?raw=true — lets an admin see exactly what Cal.com sent
 * back without having to install Cal.com's own API explorer or grep logs.
 */
export async function probeCalcomSlots(params: {
  apiKey: string;
  eventTypeId: number;
  timezone: string;
  daysAhead: number;
}): Promise<RawCalcomProbeResult> {
  const { apiKey, eventTypeId, timezone, daysAhead } = params;
  const now = new Date();
  const start = formatDateInTimezone(now, timezone);
  const end = formatDateInTimezone(new Date(now.getTime() + daysAhead * 86400_000), timezone);

  const url = new URL(`${CALCOM_API_BASE}/slots`);
  url.searchParams.set('eventTypeId', String(eventTypeId));
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('timeZone', timezone);

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'cal-api-version': CALCOM_API_VERSION,
    Accept: 'application/json',
  };
  const redactedHeaders = {
    ...headers,
    Authorization: 'Bearer ***',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    const rawText = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(rawText); } catch { parsed = rawText; }

    let slotCount: number | undefined;
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      const data = (parsed as { data: unknown }).data;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        slotCount = Object.values(data as Record<string, unknown>)
          .reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
      }
    }

    return {
      request: { url: url.toString(), method: 'GET', headers: redactedHeaders },
      response: { ok: res.ok, status: res.status, body: parsed },
      slot_count_returned: slotCount,
      computed_start: start,
      computed_end: end,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      request: { url: url.toString(), method: 'GET', headers: redactedHeaders },
      response: { ok: false, status: null, error: isAbort ? 'timeout' : String(err), body: null },
      computed_start: start,
      computed_end: end,
    };
  }
}

/** Render slots as a plain-text list for inclusion in LLM prompts */
export function slotsToPromptText(slots: SlotOption[]): string {
  if (slots.length === 0) return '';
  return slots.map((s) => `- ${s.date_display} at ${s.time_display}`).join('\n');
}
