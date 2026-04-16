import { getConfig } from './config';

export interface BusinessHoursConfig {
  enabled: boolean;
  start: string;   // "HH:MM" 24h
  end: string;     // "HH:MM" 24h
  weekdays: number[]; // ISO: 1=Mon..7=Sun
  timezone: string;   // IANA
}

export async function getBusinessHoursConfig(): Promise<BusinessHoursConfig> {
  const [enabledRaw, start, end, weekdaysRaw, timezone] = await Promise.all([
    getConfig<unknown>('business_hours_enabled', false),
    getConfig<string>('business_hours_start', '08:00'),
    getConfig<string>('business_hours_end', '17:00'),
    getConfig<unknown>('business_hours_weekdays', [1, 2, 3, 4, 5]),
    getConfig<string>('business_timezone', 'America/New_York'),
  ]);

  const enabled = enabledRaw === true || enabledRaw === 'true';
  const weekdays = Array.isArray(weekdaysRaw)
    ? (weekdaysRaw as unknown[]).map(Number).filter((n) => n >= 1 && n <= 7)
    : [1, 2, 3, 4, 5];

  return { enabled, start, end, weekdays, timezone };
}

/**
 * Parse "HH:MM" into minutes-since-midnight. Returns null on bad input.
 */
function parseClock(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Extract ISO weekday (1=Mon..7=Sun) and minutes-since-midnight for a given
 * Date, interpreted in the given IANA timezone.
 */
function localParts(date: Date, timezone: string): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value || 'Mon';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const weekday = weekdayMap[weekdayShort] ?? 1;
  const rawHour = hour === 24 ? 0 : hour;
  return { weekday, minutes: rawHour * 60 + minute };
}

/**
 * Is the given moment (default: now) outside configured business hours?
 * Returns false when business_hours_enabled is off — callers should treat
 * "disabled" as "always open".
 *
 * Handles overnight windows (e.g., 22:00-06:00) by checking whether the
 * minute falls inside the wrap-around range.
 */
export function isAfterHours(config: BusinessHoursConfig, when: Date = new Date()): boolean {
  if (!config.enabled) return false;

  const startMin = parseClock(config.start);
  const endMin = parseClock(config.end);
  if (startMin == null || endMin == null) return false;

  const { weekday, minutes } = localParts(when, config.timezone);

  if (!config.weekdays.includes(weekday)) return true;

  // Overnight window (e.g., 22:00 - 06:00): open if minute >= start OR minute < end
  if (startMin > endMin) {
    return !(minutes >= startMin || minutes < endMin);
  }
  // Normal window: open if start <= minute < end
  return !(minutes >= startMin && minutes < endMin);
}

/**
 * Human-readable summary for injection into a voice agent prompt, e.g.
 * "Mon-Fri 8:00-17:00 America/New_York".
 */
export function describeBusinessHours(config: BusinessHoursConfig): string {
  if (!config.enabled) return 'always open';
  const days = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const labels = config.weekdays.slice().sort((a, b) => a - b).map((d) => days[d]);
  return `${labels.join(',')} ${config.start}-${config.end} ${config.timezone}`;
}
