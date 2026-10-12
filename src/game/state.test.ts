// Pure date helpers behind the daily challenge: streaks and the next-challenge
// countdown must be calendar-correct (DST days are 23 or 25 hours long, so
// "now minus 24h" is not "yesterday").

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { dailyNumber, formatCountdown, msUntilNextDay, previousDayKey } from './state';

describe('previousDayKey', () => {
  test('steps back one calendar day', () => {
    expect(previousDayKey('2026-06-12')).toBe('2026-06-11');
  });

  test('crosses month and year boundaries', () => {
    expect(previousDayKey('2026-03-01')).toBe('2026-02-28');
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31');
  });

  test('knows leap years', () => {
    expect(previousDayKey('2028-03-01')).toBe('2028-02-29');
  });
});

describe('msUntilNextDay', () => {
  test('counts down to local midnight', () => {
    const now = new Date(2026, 5, 12, 21, 30, 0); // 21:30 local
    expect(msUntilNextDay(now)).toBe(2.5 * 3600 * 1000);
  });

  test('is a full day right after midnight', () => {
    const now = new Date(2026, 5, 12, 0, 0, 0);
    expect(msUntilNextDay(now)).toBe(24 * 3600 * 1000);
  });

  test('never returns zero or negative', () => {
    const now = new Date(2026, 5, 12, 23, 59, 59, 999);
    expect(msUntilNextDay(now)).toBeGreaterThan(0);
  });

  test('one second before midnight is one second', () => {
    expect(msUntilNextDay(new Date(2026, 5, 12, 23, 59, 59))).toBe(1000);
  });

  describe('on the DST days of a zone that has them', () => {
    // Date reads the zone from TZ, and Node applies a change to process.env.TZ at once.
    const zone = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/New_York';
    });
    afterAll(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    test('the spring-forward day is 23 hours long', () => {
      expect(msUntilNextDay(new Date(2026, 2, 8, 0, 0, 0))).toBe(23 * 3600 * 1000);
    });

    test('the fall-back day is 25 hours long', () => {
      expect(msUntilNextDay(new Date(2026, 10, 1, 0, 0, 0))).toBe(25 * 3600 * 1000);
    });
  });
});

describe('formatCountdown', () => {
  test('is hh:mm:ss', () => {
    expect(formatCountdown(3725000)).toBe('01:02:05');
    expect(formatCountdown(24 * 3600 * 1000)).toBe('24:00:00');
  });

  test('rounds a part second up, so the last second reads 00:00:01, never 00:00:00 before midnight', () => {
    expect(formatCountdown(1000)).toBe('00:00:01');
    expect(formatCountdown(1)).toBe('00:00:01');
    expect(formatCountdown(59_001)).toBe('00:01:00');
  });

  test('shows the 25th hour of a fall-back day instead of wrapping', () => {
    expect(formatCountdown(25 * 3600 * 1000)).toBe('25:00:00');
  });
});

describe('dailyNumber', () => {
  test('launch day is #1 and counts up by calendar day', () => {
    expect(dailyNumber('2026-06-11')).toBe(1);
    expect(dailyNumber('2026-06-12')).toBe(2);
    expect(dailyNumber('2026-07-11')).toBe(31);
  });
});
