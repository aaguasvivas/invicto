// Pure date helpers behind the daily challenge: streaks and the next-challenge
// countdown must be calendar-correct (DST days are 23 or 25 hours long, so
// "now minus 24h" is not "yesterday").

import { describe, expect, test } from 'vitest';
import { dailyNumber, msUntilNextDay, previousDayKey } from './state';

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
});

describe('dailyNumber', () => {
  test('launch day is #1 and counts up by calendar day', () => {
    expect(dailyNumber('2026-06-11')).toBe(1);
    expect(dailyNumber('2026-06-12')).toBe(2);
    expect(dailyNumber('2026-07-11')).toBe(31);
  });
});
