import { describe, it, expect } from 'vitest';
import { isAfterHours, describeBusinessHours, BusinessHoursConfig } from './business-hours';

const config = (overrides: Partial<BusinessHoursConfig> = {}): BusinessHoursConfig => ({
  enabled: true,
  start: '08:00',
  end: '17:00',
  weekdays: [1, 2, 3, 4, 5],
  timezone: 'America/New_York',
  ...overrides,
});

describe('isAfterHours', () => {
  it('returns false when business_hours_enabled is off', () => {
    // 4am Sunday — obviously "after hours" if enabled, but disabled means always open
    const sun = new Date('2026-04-19T04:00:00-04:00');
    expect(isAfterHours(config({ enabled: false }), sun)).toBe(false);
  });

  it('returns false inside hours on a weekday', () => {
    // Monday 2026-04-13, 10am Eastern
    const mon10am = new Date('2026-04-13T10:00:00-04:00');
    expect(isAfterHours(config(), mon10am)).toBe(false);
  });

  it('returns true before start on a weekday', () => {
    // Monday 7am Eastern — before 8am open
    const mon7am = new Date('2026-04-13T07:00:00-04:00');
    expect(isAfterHours(config(), mon7am)).toBe(true);
  });

  it('returns true after end on a weekday', () => {
    // Monday 6pm Eastern — after 5pm close
    const mon6pm = new Date('2026-04-13T18:00:00-04:00');
    expect(isAfterHours(config(), mon6pm)).toBe(true);
  });

  it('returns true on non-working weekday (Saturday)', () => {
    // Saturday 2026-04-18, 11am Eastern
    const sat11am = new Date('2026-04-18T11:00:00-04:00');
    expect(isAfterHours(config(), sat11am)).toBe(true);
  });

  it('handles overnight window (22:00-06:00)', () => {
    const overnight = config({ start: '22:00', end: '06:00', weekdays: [1, 2, 3, 4, 5, 6, 7] });
    // 11pm Monday — inside overnight window, should be OPEN
    expect(isAfterHours(overnight, new Date('2026-04-13T23:00:00-04:00'))).toBe(false);
    // 3am Tuesday — still inside overnight window, OPEN
    expect(isAfterHours(overnight, new Date('2026-04-14T03:00:00-04:00'))).toBe(false);
    // Noon Tuesday — outside overnight window, CLOSED
    expect(isAfterHours(overnight, new Date('2026-04-14T12:00:00-04:00'))).toBe(true);
  });

  it('returns false when start/end are malformed (fail open)', () => {
    expect(isAfterHours(config({ start: 'bad', end: '17:00' }), new Date())).toBe(false);
  });

  it('honors configured timezone when checking weekday', () => {
    // Sunday 23:00 UTC = Monday 07:00 Tokyo. Weekday check must say Monday.
    const sundayUtc = new Date('2026-04-12T23:00:00Z');
    const tokyoConfig = config({
      timezone: 'Asia/Tokyo',
      start: '06:00',
      end: '22:00',
      weekdays: [1, 2, 3, 4, 5],
    });
    // In Tokyo it's Monday 8am — open
    expect(isAfterHours(tokyoConfig, sundayUtc)).toBe(false);
  });
});

describe('describeBusinessHours', () => {
  it('summarizes enabled hours for voice agent prompt', () => {
    expect(describeBusinessHours(config())).toBe('Mon,Tue,Wed,Thu,Fri 08:00-17:00 America/New_York');
  });

  it('says "always open" when disabled', () => {
    expect(describeBusinessHours(config({ enabled: false }))).toBe('always open');
  });
});
