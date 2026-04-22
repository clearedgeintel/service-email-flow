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
        '2099-04-17': [
          '2099-04-17T09:00:00.000-05:00',
          '2099-04-17T14:00:00.000-05:00',
        ],
        '2099-04-18': ['2099-04-18T10:00:00.000-05:00'],
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
    expect(slots[0].iso).toBe('2099-04-17T09:00:00.000-05:00');
    expect(slots[0].date_display).toMatch(/Fri, Apr 17/);
    expect(slots[0].time_display).toMatch(/9:00\s*AM/i);
    expect(slots[0].booking_url).toContain('https://cal.com/me/service');
    expect(slots[0].booking_url).toContain('date=2099-04-17');
    expect(slots[0].booking_url).toContain('slot=');
  });

  it('respects maxSlots limit', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2099-04-17': [
          '2099-04-17T09:00:00.000-05:00',
          '2099-04-17T10:00:00.000-05:00',
          '2099-04-17T11:00:00.000-05:00',
          '2099-04-17T14:00:00.000-05:00',
          '2099-04-17T15:00:00.000-05:00',
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

  it('computes start/end dates in the business timezone (not UTC)', async () => {
    // Regression test for the "today's slots skipped after 7pm Central" bug.
    // Pin clock to 11pm Central Time on 2099-07-15, which is 04:00 UTC on
    // 2099-07-16. Previous code would ask Cal.com for slots starting
    // 2099-07-16, missing today's remaining hours. Fix: ask for 2099-07-15.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-07-16T04:00:00.000Z'));

    const fetchMock = vi.fn().mockResolvedValue(mockCalcomResponse({}));
    global.fetch = fetchMock;

    try {
      await fetchAvailableSlots({
        apiKey: 'cal_test',
        eventTypeId: 42,
        calcomUrl: 'https://cal.com/me/x',
        timezone: 'America/Chicago',
        daysAhead: 7,
        maxSlots: 3,
      });

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.get('start')).toBe('2099-07-15');
      expect(url.searchParams.get('timeZone')).toBe('America/Chicago');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops slots that have already passed', async () => {
    // Pin clock so 9am local is "in the past" and 3pm is still future
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-07-15T17:00:00.000Z')); // noon Central

    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2099-07-15': [
          '2099-07-15T09:00:00.000-05:00', // passed (9am CT = 14:00 UTC, before noon CT)
          '2099-07-15T15:00:00.000-05:00', // future (3pm CT)
          '2099-07-15T17:00:00.000-05:00', // future (5pm CT)
        ],
      }),
    );

    try {
      const slots = await fetchAvailableSlots({
        apiKey: 'cal_test',
        eventTypeId: 42,
        calcomUrl: 'https://cal.com/me/x',
        timezone: 'America/Chicago',
        daysAhead: 7,
        maxSlots: 5,
      });

      expect(slots).toHaveLength(2);
      expect(slots.every((s) => new Date(s.iso).getTime() >= Date.now())).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels same-day slots "Today" and next-day slots "Tomorrow"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-07-15T17:00:00.000Z')); // noon Central

    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2099-07-15': ['2099-07-15T14:00:00.000-05:00'], // today 2pm CT
        '2099-07-16': ['2099-07-16T09:00:00.000-05:00'], // tomorrow 9am CT
        '2099-07-17': ['2099-07-17T09:00:00.000-05:00'], // day after
      }),
    );

    try {
      const slots = await fetchAvailableSlots({
        apiKey: 'cal_test',
        eventTypeId: 42,
        calcomUrl: 'https://cal.com/me/x',
        timezone: 'America/Chicago',
        daysAhead: 7,
        maxSlots: 5,
      });

      expect(slots).toHaveLength(3);
      expect(slots[0].date_display).toMatch(/^Today,/);
      expect(slots[1].date_display).toMatch(/^Tomorrow,/);
      expect(slots[2].date_display).not.toMatch(/^(Today|Tomorrow),/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls through to tomorrow when today has no slots', async () => {
    // Urgency=TODAY case filed at 3pm Central but today is fully booked.
    // Cal.com returns zero for today + normal slots for tomorrow. The
    // customer should still get tomorrow's earliest offers in the reply.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-07-15T20:00:00.000Z')); // 3pm Central

    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2099-07-15': [],                                   // today: nothing
        '2099-07-16': [
          '2099-07-16T09:00:00.000-05:00',                  // tomorrow 9am
          '2099-07-16T10:30:00.000-05:00',                  // tomorrow 10:30am
          '2099-07-16T14:00:00.000-05:00',                  // tomorrow 2pm
        ],
      }),
    );

    try {
      const slots = await fetchAvailableSlots({
        apiKey: 'cal_test',
        eventTypeId: 42,
        calcomUrl: 'https://cal.com/me/x',
        timezone: 'America/Chicago',
        daysAhead: 7,
        maxSlots: 3,
      });

      expect(slots).toHaveLength(3);
      expect(slots.every((s) => s.iso.startsWith('2099-07-16'))).toBe(true);
      expect(slots[0].iso).toBe('2099-07-16T09:00:00.000-05:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls through to tomorrow when every slot today is already past', async () => {
    // Evening case: Cal.com returns some today slots but all are before now.
    // Those get filtered out; tomorrow's slots take their place.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-07-16T02:00:00.000Z')); // 9pm Central (today)

    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2099-07-15': [
          '2099-07-15T09:00:00.000-05:00',  // passed
          '2099-07-15T14:00:00.000-05:00',  // passed
        ],
        '2099-07-16': [
          '2099-07-16T09:00:00.000-05:00',  // tomorrow morning
          '2099-07-16T11:00:00.000-05:00',
        ],
      }),
    );

    try {
      const slots = await fetchAvailableSlots({
        apiKey: 'cal_test',
        eventTypeId: 42,
        calcomUrl: 'https://cal.com/me/x',
        timezone: 'America/Chicago',
        daysAhead: 7,
        maxSlots: 3,
      });

      expect(slots).toHaveLength(2);
      expect(slots.every((s) => s.iso.startsWith('2099-07-16'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops slots within the next 30 minutes (insufficient runway)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-07-15T17:00:00.000Z')); // noon Central

    global.fetch = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2099-07-15': [
          '2099-07-15T12:15:00.000-05:00', // 15 min from now — too soon
          '2099-07-15T13:00:00.000-05:00', // 1 hour from now — keep
        ],
      }),
    );

    try {
      const slots = await fetchAvailableSlots({
        apiKey: 'cal_test',
        eventTypeId: 42,
        calcomUrl: 'https://cal.com/me/x',
        timezone: 'America/Chicago',
        daysAhead: 1,
        maxSlots: 5,
      });

      expect(slots).toHaveLength(1);
      expect(slots[0].iso).toBe('2099-07-15T13:00:00.000-05:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches results within the TTL window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockCalcomResponse({
        '2099-04-17': ['2099-04-17T09:00:00.000-05:00'],
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
