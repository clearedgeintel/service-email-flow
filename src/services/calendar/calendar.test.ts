import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../cal-slots.service', () => ({
  fetchAvailableSlots: vi.fn(),
}));

import { clearDeskProvider } from './cleardesk.provider';
import { calComProvider } from './calcom.provider';
import { getActiveProviders, listAllEvents } from './index';
import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { fetchAvailableSlots } from '../cal-slots.service';

const mockedGetSupabase = vi.mocked(getSupabase);
const mockedGetConfig = vi.mocked(getConfig);
const mockedFetchSlots = vi.mocked(fetchAvailableSlots);

function mockBookingsTable(rows: Array<Record<string, unknown>>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  mockedGetSupabase.mockReturnValue({ from: vi.fn(() => chain) } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('clearDeskProvider', () => {
  it('is always configured (no credentials needed)', async () => {
    expect(await clearDeskProvider.isConfigured()).toBe(true);
  });

  it('maps ClearDesk bookings to CalendarEvent shape', async () => {
    mockBookingsTable([
      {
        id: 42,
        customer_name: 'Jane Doe',
        customer_email: 'jane@example.com',
        subject: 'AC repair',
        booking_id: 'cal_xyz',
        booking_start_at: '2026-04-20T14:00:00Z',
        booking_end_at: '2026-04-20T15:00:00Z',
        booking_status: 'booked',
      },
    ]);

    const events = await clearDeskProvider.listEvents(
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-04-21T00:00:00Z'),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'cleardesk:42',
      provider: 'cleardesk',
      title: 'Jane Doe',
      start: '2026-04-20T14:00:00Z',
      end: '2026-04-20T15:00:00Z',
      href: '/dashboard/cases/42',
      caseId: 42,
      status: 'booked',
    });
  });

  it('falls back through title candidates (name → email → subject → case #)', async () => {
    mockBookingsTable([
      { id: 1, customer_name: null, customer_email: null, subject: null, booking_start_at: '2026-04-20T14:00:00Z', booking_end_at: null, booking_status: 'booked' },
      { id: 2, customer_name: null, customer_email: 'c@e.com', subject: null, booking_start_at: '2026-04-20T15:00:00Z', booking_end_at: null, booking_status: 'booked' },
    ]);
    const events = await clearDeskProvider.listEvents(new Date(), new Date());
    expect(events[0].title).toBe('Case #1');
    expect(events[1].title).toBe('c@e.com');
  });
});

describe('calComProvider', () => {
  it('reports unconfigured when no API key', async () => {
    mockedGetConfig.mockResolvedValue('');
    expect(await calComProvider.isConfigured()).toBe(false);
  });

  it('reports configured when API key is set', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => (key === 'calcom_api_key' ? 'sk_live' : ''));
    expect(await calComProvider.isConfigured()).toBe(true);
  });

  it('returns empty slots when no event type configured', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => (key === 'calcom_api_key' ? 'sk_live' : ''));
    const slots = await calComProvider.listFreeSlots!(new Date(), new Date(Date.now() + 7 * 86400_000));
    expect(slots).toEqual([]);
    expect(mockedFetchSlots).not.toHaveBeenCalled();
  });

  it('formats cal-slots result into FreeSlot[]', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => {
      const vals: Record<string, unknown> = {
        calcom_api_key: 'sk_live',
        calcom_event_type_service: '123',
        calcom_service_url: 'https://cal.com/me/service',
        business_timezone: 'America/New_York',
      };
      return vals[key] ?? '';
    });
    mockedFetchSlots.mockResolvedValue([
      { iso: '2026-04-20T14:00:00.000-04:00', date_display: 'Mon, Apr 20', time_display: '2:00 PM', booking_url: 'https://cal.com/me/service?slot=...' },
    ]);

    const slots = await calComProvider.listFreeSlots!(
      new Date('2026-04-19T00:00:00Z'),
      new Date('2026-04-26T00:00:00Z'),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].provider).toBe('calcom');
    expect(slots[0].start).toBe('2026-04-20T14:00:00.000-04:00');
    expect(slots[0].bookingUrl).toContain('cal.com');
  });

  it('filters slots to the requested window', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => {
      const vals: Record<string, unknown> = {
        calcom_api_key: 'sk', calcom_event_type_service: '1',
        calcom_service_url: 'https://cal.com/x', business_timezone: 'UTC',
      };
      return vals[key] ?? '';
    });
    mockedFetchSlots.mockResolvedValue([
      { iso: '2026-04-20T14:00:00.000Z', date_display: '', time_display: '', booking_url: '' },
      { iso: '2026-04-30T14:00:00.000Z', date_display: '', time_display: '', booking_url: '' }, // out of range
    ]);

    const slots = await calComProvider.listFreeSlots!(
      new Date('2026-04-19T00:00:00Z'),
      new Date('2026-04-26T00:00:00Z'),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].start).toBe('2026-04-20T14:00:00.000Z');
  });
});

describe('registry: getActiveProviders + listAllEvents', () => {
  it('only returns providers whose credentials are present', async () => {
    // ClearDesk is always configured; Cal.com is not (empty config)
    mockedGetConfig.mockResolvedValue('');
    mockBookingsTable([]);

    const providers = await getActiveProviders();
    const ids = providers.map((p) => p.id);
    expect(ids).toContain('cleardesk');
    expect(ids).not.toContain('calcom');
  });

  it('fans events out across all active providers', async () => {
    mockedGetConfig.mockImplementation(async (key: string) => {
      const vals: Record<string, unknown> = {
        calcom_api_key: 'sk', calcom_event_type_service: '1',
        calcom_service_url: 'https://cal.com/x', business_timezone: 'UTC',
      };
      return vals[key] ?? '';
    });

    // ClearDesk bookings
    mockBookingsTable([
      { id: 1, customer_name: 'A', booking_start_at: '2026-04-20T10:00:00Z', booking_end_at: '2026-04-20T11:00:00Z', booking_status: 'booked' },
    ]);

    // Mock the Cal.com /bookings fetch
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: [{
          uid: 'booking_1', start: '2026-04-20T14:00:00Z', end: '2026-04-20T15:00:00Z',
          title: 'Consult', status: 'booked', attendees: [{ name: 'B', email: 'b@e.com' }],
        }],
      }),
    }) as any;

    const events = await listAllEvents(new Date('2026-04-20T00:00:00Z'), new Date('2026-04-21T00:00:00Z'));

    global.fetch = originalFetch;

    expect(events).toHaveLength(2);
    const providers = events.map((e) => e.provider).sort();
    expect(providers).toEqual(['calcom', 'cleardesk']);
  });
});
