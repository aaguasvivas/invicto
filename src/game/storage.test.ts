// Every localStorage touch goes through storage.ts. Real browsers fail in two
// ways: blocked site data (and third-party iframes denied storage) throws from
// the `localStorage` getter itself, and a full disk throws QuotaExceededError
// from setItem. Either way the game must keep running, just without memory.
// Saved data from earlier versions must keep loading: same keys, same formats.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makePlayer } from '../engine/test-helpers';
import { installStorage } from '../test/fakedom';
import type { GameData } from './data';
import * as storage from './storage';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  vi.unstubAllGlobals();
});

describe('storage helper', () => {
  test('reads, writes, removes and lists keys', () => {
    const map = installStorage();
    storage.set('invicto.a', '1');
    storage.set('invicto.b', '2');
    expect(storage.get('invicto.a')).toBe('1');
    expect(storage.keys().sort()).toEqual(['invicto.a', 'invicto.b']);
    storage.remove('invicto.a');
    expect(storage.get('invicto.a')).toBeNull();
    expect([...map.keys()]).toEqual(['invicto.b']);
  });

  test('blocked storage reads as empty and ignores writes', () => {
    installStorage('blocked');
    expect(storage.get('invicto.a')).toBeNull();
    expect(() => storage.set('invicto.a', '1')).not.toThrow();
    expect(() => storage.remove('invicto.a')).not.toThrow();
    expect(storage.keys()).toEqual([]);
  });

  test('full storage still reads and ignores the failed write', () => {
    const map = installStorage('full', new Map([['invicto.a', '1']]));
    expect(() => storage.set('invicto.b', '2')).not.toThrow();
    expect(storage.get('invicto.a')).toBe('1');
    expect(map.has('invicto.b')).toBe(false);
  });

  test('a null localStorage reads as empty', () => {
    vi.stubGlobal('localStorage', null);
    expect(storage.get('invicto.a')).toBeNull();
    expect(() => storage.set('invicto.a', '1')).not.toThrow();
    expect(storage.keys()).toEqual([]);
  });
});

/** Fresh module instances, as on a page load, so i18n reads storage at import. */
async function loadGame() {
  vi.resetModules();
  vi.stubGlobal('navigator', { languages: ['es-DO'], language: 'es-DO' });
  const i18n = await import('../i18n');
  const state = await import('./state');
  const history = await import('./history');
  const badges = await import('./badges');
  const stats = await import('./stats');
  return { i18n, state, history, badges, stats };
}

const result = { record: '5-2', wins: 5, losses: 2, outcome: 'subcampeon' as const };

describe.each(['blocked', 'full'] as const)('the game with %s storage', (fault) => {
  beforeEach(() => {
    installStorage(fault);
  });

  test('i18n loads and falls back to the browser language', async () => {
    const { i18n } = await loadGame();
    expect(i18n.getLang()).toBe('es');
  });

  test('state, history, badges and stats calls never throw', async () => {
    const { state, history, badges } = await loadGame();
    expect(history.currentStreak()).toBe(0);
    expect(history.dailyEntries()).toEqual([]);
    expect(state.soundOn()).toBe(false);
    expect(() => state.setSound(true)).not.toThrow();
    expect(() => state.saveDailyResult(result, '2026-10-11')).not.toThrow();
    expect(() => state.saveBest('free', result)).not.toThrow();
    expect(badges.recordBadges(['invicto'])).toEqual(['invicto']);
  });

  test('clientId falls back to an id kept in memory for this page', async () => {
    const { stats } = await loadGame();
    const id = stats.clientId();
    expect(id.length).toBeGreaterThan(8);
    expect(stats.clientId()).toBe(id);
  });
});

// Exactly what the shipped game (before storage.ts) writes for a returning player
// on a 5-day streak: a key per scored daily, and the streak counter it kept then.
const SAVED: Record<string, string> = {
  'invicto.lang': 'en',
  'invicto.sound': 'on',
  'invicto.streak': '5',
  'invicto.lastDaily': '2026-10-10',
  'invicto.daily.2026-10-06': '{"record":"3-2","wins":3,"losses":2,"outcome":"eliminated-qf"}',
  'invicto.daily.2026-10-07': '{"record":"6-1","wins":6,"losses":1,"outcome":"campeon"}',
  'invicto.daily.2026-10-08': '{"record":"2-2","wins":2,"losses":2,"outcome":"eliminated-pool"}',
  'invicto.daily.2026-10-09': '{"record":"4-2","wins":4,"losses":2,"outcome":"eliminated-sf"}',
  'invicto.daily.2026-10-10': '{"record":"5-2","wins":5,"losses":2,"outcome":"subcampeon"}',
  'invicto.best.free': '{"record":"7-0","wins":7,"losses":0,"outcome":"invicto"}',
  'invicto.best.hard': '{"record":"4-3","wins":4,"losses":3,"outcome":"eliminated-sf"}',
  'invicto.badges': '{"invicto":"2026-09-01T18:30:00.000Z","seis_editiones":"2026-09-20T01:02:03.000Z"}',
  'invicto.clientId': '8f1c2a8e-5a8b-4c47-9f3e-2d6f0b1e7c11',
  'invicto.run':
    '{"v":1,"mode":"free","seed":"free-mabc12-x9","scored":true,"day":"2026-10-10","lineup":{"C":"2023-ven-perez","SP":"2006-ven-santana"},' +
    '"draftedPersons":["perez|1990-01-01","santana|1979-03-29"],"round":2,"countryRerollUsed":true,"editionRerollUsed":false,' +
    '"roll":{"country":"VEN","edition":2006},"redrawAttempt":0,"savedAt":1791676800000}',
};

describe('data saved by earlier versions', () => {
  test('loads with the same language, sound, streak, history, bests, badges, client id and resumable run', async () => {
    installStorage('none', new Map(Object.entries(SAVED)));
    const { i18n, state, history, badges, stats } = await loadGame();
    const resume = await import('./resume');

    expect(i18n.getLang()).toBe('en');
    expect(state.soundOn()).toBe(true);
    expect(history.currentStreak('2026-10-11')).toBe(5); // derived from the day keys, as the counter had it
    expect(history.dailyStats(history.dailyEntries(), '2026-10-11')).toMatchObject({ played: 5, titles: 1, bestStreak: 5 });
    expect(state.dailyResult('2026-10-10')).toEqual(result);
    expect(state.personalBest('free')).toEqual({ record: '7-0', wins: 7, losses: 0, outcome: 'invicto' });
    expect(state.personalBest('hard')?.record).toBe('4-3');
    expect(badges.earnedBadges()).toEqual({ invicto: '2026-09-01T18:30:00.000Z', seis_editiones: '2026-09-20T01:02:03.000Z' });
    expect(stats.clientId()).toBe('8f1c2a8e-5a8b-4c47-9f3e-2d6f0b1e7c11');

    const snap = resume.loadRun()!;
    expect(snap).toEqual(JSON.parse(SAVED['invicto.run']));
    const p1 = makePlayer({ id: '2023-ven-perez', personKey: 'perez|1990-01-01', positions: ['C'] });
    const p2 = makePlayer({ id: '2006-ven-santana', personKey: 'santana|1979-03-29', positions: ['SP'] });
    const data: GameData = { players: [p1, p2], byTeam: new Map(), editionTeams: { 2006: ['VEN'] }, countries: new Map() };
    const session = resume.restoreSession(snap, data)!;
    expect(session.state.lineup.C?.id).toBe(p1.id);
    expect(session.state.round).toBe(2);
  });

  test('writes the same keys in the same formats, and leaves the retired streak keys alone', async () => {
    const map = installStorage('none', new Map(Object.entries(SAVED)));
    const { state, history, badges } = await loadGame();
    const day = { record: '6-1', wins: 6, losses: 1, outcome: 'campeon' as const };

    state.saveDailyResult(day, '2026-10-11');
    state.saveBest('hard', day);
    state.setSound(false);
    badges.recordBadges(['campeon']);

    expect(map.get('invicto.daily.2026-10-11')).toBe('{"record":"6-1","wins":6,"losses":1,"outcome":"campeon"}');
    expect(history.currentStreak('2026-10-11')).toBe(6);
    expect(map.get('invicto.streak')).toBe('5');
    expect(map.get('invicto.lastDaily')).toBe('2026-10-10');
    expect(map.get('invicto.best.hard')).toBe('{"record":"6-1","wins":6,"losses":1,"outcome":"campeon"}');
    expect(map.get('invicto.sound')).toBe('off');
    expect(Object.keys(JSON.parse(map.get('invicto.badges')!))).toEqual(['invicto', 'seis_editiones', 'campeon']);
  });
});
