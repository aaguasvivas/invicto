// recordRun commits a finished run the moment the draft completes, before the
// sim reveal: the scored daily (one per dealt day), the streak, the personal
// best and badges. A reload during the 7-10 s reveal must find the day played.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lineupWithMeans } from '../engine/test-helpers';
import type { Outcome, RunResult } from '../engine/types';
import { installStorage } from '../test/fakedom';
import { earnedBadges } from './badges';
import type { GameData } from './data';
import { recordRun } from './finish';
import type { Session } from './session';
import { currentStreak, dailyResult, personalBest } from './state';

const data: GameData = { players: [], byTeam: new Map(), editionTeams: {}, countries: new Map() };
const lineup = lineupWithMeans(72, 70, 56, 58, 72, 70); // all 12 from the 2023 edition

function session(over: Partial<Session> = {}): Session {
  return {
    mode: 'daily',
    seed: 'daily-2026-10-11',
    scored: true,
    day: '2026-10-11',
    data,
    state: { lineup, draftedPersons: [], round: 12, countryRerollUsed: false, editionRerollUsed: false },
    roll: { country: 'VEN', edition: 2023 },
    redrawAttempt: 0,
    autoRedrew: false,
    ...over,
  };
}

function finished(wins: number, losses: number, outcome: Outcome): RunResult {
  return { teamRating: 75, games: [], wins, losses, outcome };
}

const qf = finished(3, 2, 'eliminated-qf');
const runnerUp = finished(5, 2, 'subcampeon');

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('recordRun: the scored daily', () => {
  test('saves the first scored daily for the day it was dealt, and the best', () => {
    recordRun(session(), qf);
    expect(dailyResult('2026-10-11')).toEqual({ record: '3-2', wins: 3, losses: 2, outcome: 'eliminated-qf' });
    expect(personalBest('daily')?.record).toBe('3-2');
  });

  test('a second attempt never overwrites the first and turns practice (a second tab)', () => {
    recordRun(session(), qf);
    const other = session();
    recordRun(other, runnerUp);
    expect(other.scored).toBe(false);
    expect(dailyResult('2026-10-11')?.record).toBe('3-2');
    expect(personalBest('daily')?.record).toBe('3-2');
  });

  test('replaying the same run after a reload stays scored', () => {
    recordRun(session(), qf);
    const resumed = session();
    recordRun(resumed, qf);
    expect(resumed.scored).toBe(true);
    expect(dailyResult('2026-10-11')?.record).toBe('3-2');
  });

  test('practice saves nothing but still earns badges', () => {
    const earned = recordRun(session({ scored: false }), qf);
    expect(earned).toContain('una_sola_edicion');
    expect(earnedBadges().una_sola_edicion).toBeDefined();
    expect(dailyResult('2026-10-11')).toBeNull();
    expect(personalBest('daily')).toBeNull();
  });

  test('free play saves the best and no daily', () => {
    recordRun(session({ mode: 'free', seed: 'free-abc' }), runnerUp);
    expect(personalBest('free')?.record).toBe('5-2');
    expect([...store.keys()].filter((k) => k.startsWith('invicto.daily.'))).toEqual([]);
  });

  test('badges pop only the first time they are earned', () => {
    expect(recordRun(session({ mode: 'free' }), qf)).toContain('una_sola_edicion');
    expect(recordRun(session({ mode: 'free' }), qf)).toEqual([]);
  });
});

describe('recordRun: the streak', () => {
  function playedThrough(day: string, streak: number) {
    store.set('invicto.lastDaily', day);
    store.set('invicto.streak', String(streak));
  }

  test('grows when the previous day was played', () => {
    playedThrough('2026-10-10', 5);
    recordRun(session(), qf);
    expect(currentStreak('2026-10-11')).toBe(6);
  });

  test('counts for the dealt day when the result lands after midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 0, 3));
    playedThrough('2026-10-10', 5);
    recordRun(session(), qf);
    expect(dailyResult('2026-10-11')?.record).toBe('3-2');
    expect(dailyResult('2026-10-12')).toBeNull();
    expect(currentStreak('2026-10-12')).toBe(6);
  });

  test('resets after a missed day', () => {
    playedThrough('2026-10-09', 5);
    recordRun(session(), qf);
    expect(currentStreak('2026-10-11')).toBe(1);
  });

  test('a late result for an earlier day leaves the newer streak alone', () => {
    playedThrough('2026-10-12', 3);
    recordRun(session(), qf);
    expect(dailyResult('2026-10-11')?.record).toBe('3-2');
    expect(store.get('invicto.lastDaily')).toBe('2026-10-12');
    expect(currentStreak('2026-10-12')).toBe(3);
  });
});

describe('recordRun: the replay of a committed run (a reload during the reveal)', () => {
  test('still pops the badges the commit unlocked', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 12, 0, 0));
    const savedAt = Date.now(); // the snapshot of the 12th pick, just before the commit
    expect(recordRun(session(), qf)).toContain('una_sola_edicion');

    vi.setSystemTime(new Date(2026, 9, 11, 12, 0, 20)); // the phone reloads mid-reveal and resumes
    expect(recordRun(session(), qf, savedAt)).toContain('una_sola_edicion');
  });

  test('leaves out a badge an earlier run had unlocked', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0));
    recordRun(session({ mode: 'free', seed: 'free-abc' }), qf); // una_sola_edicion, the day before
    vi.setSystemTime(new Date(2026, 9, 11, 12, 0));
    const savedAt = Date.now();
    expect(recordRun(session(), qf)).toEqual([]);
    expect(recordRun(session(), qf, savedAt)).toEqual([]);
  });
});
