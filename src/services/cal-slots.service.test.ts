import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { fetchAvailableSlots, slotsToPromptText, clearSlotCache } from './cal-slots.service';

beforeEach(() => {
  clearSlotCache();
  vi.restoreAllMocks();
});

function mockCalcomResponse(data: Record<string, string[]>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', data }),
  } as unknown as Response;
}

describe('fetchAvailableSlots', () => {
  it('returns [] when apiKey is empty', async () => {
    const slots = await fetchAvailableSlots({
      apiKey: '',
      eventTypeId: 42,
      calcomUrl: 'https://cal.com/me/x',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 3,
    });
    expect(slots).toEqual([]);
  });

  it('returns [] when eventTypeId is 0 or negative', async () => {
    const slots = await fetchAvailableSlots({
      apiKey: 'cal_test',
      eventTypeId: 0,
      calcomUrl: 'https://cal.com/me/x',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 3,
    });
    expect(slots).toEqual([]);
  });

  it('fetches and formats slots', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2026-04-17': [
          '2026-04-17T09:00:00.000-05:00',
          '2026-04-17T14:00:00.000-05:00',
        ],
        '2026-04-18': ['2026-04-18T10:00:00.000-05:00'],
      }),
    );

    const slots = await fetchAvailableSlots({
      apiKey: 'cal_test_key',
      eventTypeId: 42,
      calcomUrl: 'https://cal.com/me/service',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 3,
    });

    expect(slots).toHaveLength(3);
    expect(slots[0].iso).toBe('2026-04-17T09:00:00.000-05:00');
    expect(slots[0].date_display).toMatch(/Fri, Apr 17/);
    expect(slots[0].time_display).toMatch(/9:00\s*AM/i);
    expect(slots[0].booking_url).toContain('https://cal.com/me/service');
    expect(slots[0].booking_url).toContain('date=2026-04-17');
    expect(slots[0].booking_url).toContain('slot=');
  });

  it('respects maxSlots limit', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2026-04-17': [
          '2026-04-17T09:00:00.000-05:00',
          '2026-04-17T10:00:00.000-05:00',
          '2026-04-17T11:00:00.000-05:00',
          '2026-04-17T14:00:00.000-05:00',
          '2026-04-17T15:00:00.000-05:00',
        ],
      }),
    );

    const slots = await fetchAvailableSlots({
      apiKey: 'cal_test',
      eventTypeId: 42,
      calcomUrl: 'https://cal.com/me/x',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 2,
    });
    expect(slots).toHaveLength(2);
  });

  it('returns [] on non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as unknown as Response);

    const slots = await fetchAvailableSlots({
      apiKey: 'bad_key',
      eventTypeId: 42,
      calcomUrl: 'https://cal.com/me/x',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 3,
    });
    expect(slots).toEqual([]);
  });

  it('returns [] on fetch failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const slots = await fetchAvailableSlots({
      apiKey: 'cal_test',
      eventTypeId: 42,
      calcomUrl: 'https://cal.com/me/x',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 3,
    });
    expect(slots).toEqual([]);
  });

  it('sends required Cal.com API headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockCalcomResponse({}));
    global.fetch = fetchMock;

    await fetchAvailableSlots({
      apiKey: 'cal_test_key',
      eventTypeId: 42,
      calcomUrl: 'https://cal.com/me/x',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 3,
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer cal_test_key');
    expect(headers['cal-api-version']).toBe('2024-09-04');
  });

  it('caches results within the TTL window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2026-04-17': ['2026-04-17T09:00:00.000-05:00'],
      }),
    );
    global.fetch = fetchMock;

    const params = {
      apiKey: 'cal_test',
      eventTypeId: 42,
      calcomUrl: 'https://cal.com/me/x',
      timezone: 'America/Chicago',
      daysAhead: 7,
      maxSlots: 3,
    };

    await fetchAvailableSlots(params);
    await fetchAvailableSlots(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('slotsToPromptText', () => {
  it('formats slots as a markdown list', () => {
    const text = slotsToPromptText([
      { iso: '', date_display: 'Thu, Apr 17', time_display: '9:00 AM', booking_url: '' },
      { iso: '', date_display: 'Fri, Apr 18', time_display: '2:00 PM', booking_url: '' },
    ]);
    expect(text).toBe('- Thu, Apr 17 at 9:00 AM\n- Fri, Apr 18 at 2:00 PM');
  });

  it('returns empty string for empty array', () => {
    expect(slotsToPromptText([])).toBe('');
  });
});
