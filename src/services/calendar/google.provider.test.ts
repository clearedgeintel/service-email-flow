import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module-level mock for googleapis — a single shared listMock lets each test
// control what events.list returns (and whether it throws).
const listMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    calendar: () => ({ events: { list: listMock } }),
  },
}));

vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { googleCalendarProvider, resetGoogleCalendarClient } from './google.provider';
import { getConfig } from '@/lib/config';

const mockedGetConfig = vi.mocked(getConfig);

function setEnv(overrides: Record<string, string | undefined> = {}) {
  process.env.GMAIL_CLIENT_ID = overrides.GMAIL_CLIENT_ID ?? 'test-client-id';
  process.env.GMAIL_CLIENT_SECRET = overrides.GMAIL_CLIENT_SECRET ?? 'test-client-secret';
  process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = overrides.GOOGLE_CALENDAR_REFRESH_TOKEN ?? 'test-refresh-token';
}

function setConfig(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    google_calendar_enabled: true,
    google_calendar_id: 'primary',
    google_calendar_show_titles: true,
  };
  const merged = { ...defaults, ...overrides };
  mockedGetConfig.mockImplementation(async (key: string) =>
    merged[key] === undefined ? ('' as unknown) : merged[key],
  ) as any;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  resetGoogleCalendarClient();
  setEnv();
});

afterEach(() => {
  // Restore the three env vars we may have touched
  process.env.GMAIL_CLIENT_ID = ORIGINAL_ENV.GMAIL_CLIENT_ID;
  process.env.GMAIL_CLIENT_SECRET = ORIGINAL_ENV.GMAIL_CLIENT_SECRET;
  process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = ORIGINAL_ENV.GOOGLE_CALENDAR_REFRESH_TOKEN;
});

describe('googleCalendarProvider.isConfigured', () => {
  it('returns false when google_calendar_enabled is off', async () => {
    setConfig({ google_calendar_enabled: false });
    expect(await googleCalendarProvider.isConfigured()).toBe(false);
  });

  it('returns false when env vars are missing (refresh token)', async () => {
    setConfig({});
    delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
    expect(await googleCalendarProvider.isConfigured()).toBe(false);
  });

  it('returns false when env vars are missing (client id)', async () => {
    setConfig({});
    delete process.env.GMAIL_CLIENT_ID;
    expect(await googleCalendarProvider.isConfigured()).toBe(false);
  });

  it('returns true when setting is on AND env vars present', async () => {
    setConfig({});
    expect(await googleCalendarProvider.isConfigured()).toBe(true);
  });

  it('accepts string "true" from settings (JSONB legacy)', async () => {
    setConfig({ google_calendar_enabled: 'true' });
    expect(await googleCalendarProvider.isConfigured()).toBe(true);
  });
});

describe('googleCalendarProvider.listEvents', () => {
  const from = new Date('2099-07-15T00:00:00Z');
  const to = new Date('2099-07-22T00:00:00Z');

  it('maps Google events to CalendarEvent[] with real titles by default', async () => {
    setConfig({});
    listMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt1',
            summary: 'Dentist appointment',
            status: 'confirmed',
            start: { dateTime: '2099-07-15T14:00:00-05:00' },
            end: { dateTime: '2099-07-15T15:00:00-05:00' },
            htmlLink: 'https://calendar.google.com/event?eid=xyz',
            organizer: { email: 'me@example.com' },
          },
        ],
      },
    });

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'google:evt1',
      provider: 'google',
      title: 'Dentist appointment',
      start: '2099-07-15T14:00:00-05:00',
      end: '2099-07-15T15:00:00-05:00',
      href: 'https://calendar.google.com/event?eid=xyz',
    });
  });

  it('renders "Busy" when google_calendar_show_titles is false', async () => {
    setConfig({ google_calendar_show_titles: false });
    listMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt1',
            summary: 'Therapy session — private',
            status: 'confirmed',
            start: { dateTime: '2099-07-15T14:00:00-05:00' },
            end: { dateTime: '2099-07-15T15:00:00-05:00' },
          },
        ],
      },
    });

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events[0].title).toBe('Busy');
  });

  it('passes custom calendarId through to events.list', async () => {
    setConfig({ google_calendar_id: 'team@group.calendar.google.com' });
    listMock.mockResolvedValue({ data: { items: [] } });

    await googleCalendarProvider.listEvents(from, to);
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'team@group.calendar.google.com' }),
    );
  });

  it('falls back to "primary" when google_calendar_id is empty', async () => {
    setConfig({ google_calendar_id: '' });
    listMock.mockResolvedValue({ data: { items: [] } });

    await googleCalendarProvider.listEvents(from, to);
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'primary' }),
    );
  });

  it('drops cancelled, transparent, and self-declined events', async () => {
    setConfig({});
    listMock.mockResolvedValue({
      data: {
        items: [
          { id: 'keep', status: 'confirmed', start: { dateTime: '2099-07-15T10:00:00Z' }, end: { dateTime: '2099-07-15T11:00:00Z' } },
          { id: 'cancelled', status: 'cancelled', start: { dateTime: '2099-07-15T10:00:00Z' }, end: { dateTime: '2099-07-15T11:00:00Z' } },
          { id: 'transparent', status: 'confirmed', transparency: 'transparent', start: { dateTime: '2099-07-15T10:00:00Z' }, end: { dateTime: '2099-07-15T11:00:00Z' } },
          {
            id: 'declined',
            status: 'confirmed',
            start: { dateTime: '2099-07-15T10:00:00Z' },
            end: { dateTime: '2099-07-15T11:00:00Z' },
            attendees: [{ self: true, responseStatus: 'declined' }],
          },
        ],
      },
    });

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events.map((e) => e.id)).toEqual(['google:keep']);
  });

  it('normalizes all-day events (start.date without dateTime)', async () => {
    setConfig({});
    listMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'holiday',
            summary: 'Vacation',
            status: 'confirmed',
            start: { date: '2099-07-15' },
            end: { date: '2099-07-16' },
          },
        ],
      },
    });

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events).toHaveLength(1);
    expect(events[0].start).toBe('2099-07-15T00:00:00Z');
    expect(events[0].end).toBe('2099-07-16T00:00:00Z');
    expect(events[0].metadata?.all_day).toBe(true);
  });

  it('follows nextPageToken across multiple pages', async () => {
    setConfig({});
    listMock
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: 'p1', status: 'confirmed', start: { dateTime: '2099-07-15T10:00:00Z' }, end: { dateTime: '2099-07-15T11:00:00Z' } },
          ],
          nextPageToken: 'token-2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: 'p2', status: 'confirmed', start: { dateTime: '2099-07-16T10:00:00Z' }, end: { dateTime: '2099-07-16T11:00:00Z' } },
          ],
        },
      });

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events.map((e) => e.id)).toEqual(['google:p1', 'google:p2']);
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('returns [] on thrown error (token revoked, network, etc.)', async () => {
    setConfig({});
    listMock.mockRejectedValue(new Error('invalid_grant'));

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events).toEqual([]);
  });

  it('returns [] when env vars missing (no client built)', async () => {
    setConfig({});
    delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events).toEqual([]);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('records recurring_event_id and organizer in metadata', async () => {
    setConfig({});
    listMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'instance-1',
            summary: 'Weekly sync',
            status: 'confirmed',
            recurringEventId: 'master-abc',
            organizer: { email: 'boss@example.com' },
            start: { dateTime: '2099-07-15T10:00:00Z' },
            end: { dateTime: '2099-07-15T11:00:00Z' },
          },
        ],
      },
    });

    const events = await googleCalendarProvider.listEvents(from, to);
    expect(events[0].metadata).toMatchObject({
      recurring_event_id: 'master-abc',
      organizer: 'boss@example.com',
      all_day: false,
    });
  });
});
