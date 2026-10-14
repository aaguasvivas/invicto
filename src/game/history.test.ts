// The daily history is read back from the day keys saveDailyResult writes, so
// the streak is derived, never counted: these pin the derived numbers on
// synthetic histories, and pin that they equal what the old stored counter
// (invicto.streak + invicto.lastDaily, retired) gave every normal history.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Outcome } from '../engine/types';
import { installStorage } from '../test/fakedom';
import { currentStreak, dailyEntries, dailyStats, type DailyEntry } from './history';
import { formatDayKey, previousDayKey, saveDailyResult, type StoredResult } from './state';

const RESULT: Record<Outcome, StoredResult> = {
  'eliminated-pool': { record: '1-3', wins: 1, losses: 3, outcome: 'eliminated-pool' },
  'eliminated-qf': { record: '3-2', wins: 3, losses: 2, outcome: 'eliminated-qf' },
  'eliminated-sf': { record: '4-2', wins: 4, losses: 2, outcome: 'eliminated-sf' },
  subcampeon: { record: '5-2', wins: 5, losses: 2, outcome: 'subcampeon' },
  campeon: { record: '6-1', wins: 6, losses: 1, outcome: 'campeon' },
  invicto: { record: '7-0', wins: 7, losses: 0, outcome: 'invicto' },
};

/** n consecutive local days ending on `last`, oldest first. */
function daysEnding(last: string, n: number): string[] {
  const days = [last];
  while (days.length < n) days.unshift(previousDayKey(days[0]));
  return days;
}

const entries = (days: string[], outcome: Outcome = 'eliminated-qf'): DailyEntry[] => days.map((day) => ({ day, result: RESULT[outcome] }));

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});

describe('dailyEntries', () => {
  test('reads every scored daily from its day key, oldest first', () => {
    store.set('invicto.daily.2026-10-11', JSON.stringify(RESULT.campeon));
    store.set('invicto.daily.2026-09-30', JSON.stringify(RESULT.subcampeon));
    store.set('invicto.daily.2026-10-02', JSON.stringify({ ...RESULT['eliminated-sf'], grade: 'B' }));
    expect(dailyEntries()).toEqual([
      { day: '2026-09-30', result: RESULT.subcampeon },
      { day: '2026-10-02', result: { ...RESULT['eliminated-sf'], grade: 'B' } },
      { day: '2026-10-11', result: RESULT.campeon },
    ]);
  });

  test('takes only keys of the exact day-key shape, and skips an entry it cannot read', () => {
    const value = JSON.stringify(RESULT.invicto);
    for (const key of ['invicto.daily.2026-10-1', 'invicto.daily.2026-10-11.bak', 'x.invicto.daily.2026-10-11', 'invicto.dailyX2026-10-11', 'invicto.streak', 'invicto.best.free']) {
      store.set(key, value);
    }
    store.set('invicto.daily.2026-10-09', '{not json');
    store.set('invicto.daily.2026-10-10', JSON.stringify({ record: '9-9' }));
    store.set('invicto.daily.2026-10-12', value);
    expect(dailyEntries().map((e) => e.day)).toEqual(['2026-10-12']);
  });

  test('is empty when storage throws: on reading a key, or on reaching localStorage at all', () => {
    store.set('invicto.daily.2026-10-11', JSON.stringify(RESULT.campeon));
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    const throwing = { ...(real.get!() as Storage), length: 1, key: () => { throw new DOMException('denied', 'SecurityError'); } };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => throwing });
    expect(dailyEntries()).toEqual([]);

    installStorage('blocked', store);
    expect(dailyEntries()).toEqual([]);
  });
});

describe('dailyStats', () => {
  test('seven days in a row: played, titles, the streak and a count per tier', () => {
    const days = daysEnding('2026-10-11', 7);
    const outcomes: Outcome[] = ['eliminated-pool', 'eliminated-qf', 'eliminated-qf', 'eliminated-sf', 'subcampeon', 'campeon', 'invicto'];
    const history = days.map((day, i) => ({ day, result: RESULT[outcomes[i]] }));
    expect(dailyStats(history, '2026-10-11')).toEqual({
      played: 7,
      titles: 2,
      invictos: 1,
      streak: 7,
      bestStreak: 7,
      tiers: { 'eliminated-pool': 1, 'eliminated-qf': 2, 'eliminated-sf': 1, subcampeon: 1, campeon: 1, invicto: 1 },
    });
  });

  test('the streak stays alive until today is over, and is gone the day after a missed one', () => {
    const history = entries(daysEnding('2026-10-11', 7));
    expect(dailyStats(history, '2026-10-12').streak).toBe(7); // today not played yet
    expect(dailyStats(history, '2026-10-13').streak).toBe(0); // yesterday missed
    expect(dailyStats(history, '2026-10-13').bestStreak).toBe(7);
  });

  test('a one-day gap restarts the streak; the best keeps the longer run', () => {
    const history = entries([...daysEnding('2026-10-05', 5), ...daysEnding('2026-10-11', 3)]); // 10-06 missed
    expect(dailyStats(history, '2026-10-11')).toMatchObject({ played: 8, streak: 3, bestStreak: 5 });
    expect(dailyStats(entries([...daysEnding('2026-10-08', 3), ...daysEnding('2026-10-11', 2)]), '2026-10-11')).toMatchObject({
      streak: 2,
      bestStreak: 3,
    });
  });

  test('the order of the entries does not matter', () => {
    const history = entries([...daysEnding('2026-10-05', 5), ...daysEnding('2026-10-11', 3)]);
    expect(dailyStats([...history].reverse(), '2026-10-11')).toEqual(dailyStats(history, '2026-10-11'));
  });

  test('no history: all zeros', () => {
    expect(dailyStats([], '2026-10-11')).toEqual({
      played: 0,
      titles: 0,
      invictos: 0,
      streak: 0,
      bestStreak: 0,
      tiers: { 'eliminated-pool': 0, 'eliminated-qf': 0, 'eliminated-sf': 0, subcampeon: 0, campeon: 0, invicto: 0 },
    });
  });

  test('a day after today (a clock set back) never counts toward the current streak', () => {
    const history = entries(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(dailyStats(history, '2026-10-11')).toMatchObject({ played: 3, streak: 2, bestStreak: 3 });
  });

  describe('across the DST changes of America/New_York', () => {
    // Date reads the zone from TZ, and Node applies a change to process.env.TZ at once.
    const zone = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/New_York';
    });
    afterAll(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    test.each([
      ['spring forward (a 23-hour 2026-03-08)', '2026-03-11'],
      ['fall back (a 25-hour 2026-11-01)', '2026-11-04'],
    ])('%s: a week of dailies is a 7-day streak', (_, last) => {
      const days = daysEnding(last, 7);
      expect(days).toHaveLength(new Set(days).size);
      expect(dailyStats(entries(days), last)).toMatchObject({ streak: 7, bestStreak: 7 });
    });

    test('the days come from the calendar, saved one each day', () => {
      for (let d = 5; d <= 11; d++) saveDailyResult(RESULT.subcampeon, formatDayKey(new Date(2026, 2, d)));
      expect(currentStreak('2026-03-11')).toBe(7);
    });
  });
});

describe('currentStreak', () => {
  test('a day saved after the next one (its run finished in another tab) joins the streak', () => {
    saveDailyResult(RESULT.campeon, '2026-10-12');
    saveDailyResult(RESULT.subcampeon, '2026-10-11'); // day D lands after D+1
    expect(currentStreak('2026-10-12')).toBe(2);
  });

  test('comes from the day keys alone: the retired counter keys are ignored', () => {
    store.set('invicto.streak', '9');
    store.set('invicto.lastDaily', '2026-10-11');
    expect(currentStreak('2026-10-11')).toBe(0);
    saveDailyResult(RESULT.campeon, '2026-10-11');
    expect(currentStreak('2026-10-11')).toBe(1);
    expect([store.get('invicto.streak'), store.get('invicto.lastDaily')]).toEqual(['9', '2026-10-11']); // left as they were
  });

  test('saving a daily writes its day key and nothing else', () => {
    saveDailyResult(RESULT.campeon, '2026-10-11');
    expect([...store.keys()]).toEqual(['invicto.daily.2026-10-11']);
  });
});

/**
 * The retired counter, rule for rule: a save on the day after the last one
 * grows the stored streak, any other save restarts it at 1, a save for a day
 * before the last one changes nothing, and the streak reads 0 once neither
 * today nor yesterday was the last day.
 */
function oldCounter(savedInOrder: string[], today: string): number {
  let streak = 0;
  let last: string | null = null;
  for (const day of savedInOrder) {
    if (last && last > day) continue;
    streak = last === previousDayKey(day) ? streak + 1 : 1;
    last = day;
  }
  return last === today || last === previousDayKey(today) ? streak : 0;
}

describe('the derived streak against the old counter', () => {
  test('equal on every in-order history of a 10-day window, read on each of the 3 days after it', () => {
    const window = daysEnding('2026-03-14', 10); // spans the 2026-03-08 DST change wherever TZ has one
    const readOn = ['2026-03-14', '2026-03-15', '2026-03-16'];
    let compared = 0;
    for (let mask = 1; mask < 1 << window.length; mask++) {
      const played = window.filter((_, i) => mask & (1 << i));
      for (const today of readOn) {
        expect(dailyStats(entries(played), today).streak, `${played.join(',')} read on ${today}`).toBe(oldCounter(played, today));
        compared++;
      }
    }
    expect(compared).toBe(1023 * 3);
  });

  test('the case they differ: day D saved after D+1 counts 2, where the counter stayed at 1', () => {
    expect(oldCounter(['2026-10-12', '2026-10-11'], '2026-10-12')).toBe(1);
    expect(dailyStats(entries(['2026-10-11', '2026-10-12']), '2026-10-12').streak).toBe(2);
  });
});
