// A session deals its own seed unless a challenge link brings one: then the
// friend's exact seed deals the same rolls, and nothing else changes.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import editionsJson from '../../public/data/editions.json';
import { rollBase } from '../engine/draft';
import { makePlayer } from '../engine/test-helpers';
import type { EditionTeams, EnginePlayer, Slot } from '../engine/types';
import type { GameData } from './data';
import { newSession } from './session';

const TEAMS: EditionTeams = Object.fromEntries(editionsJson.editions.map((e) => [e.year, e.teams.map((t) => t.code)]));

// One player of every position on every roster: every roll offers a legal pick.
const players: EnginePlayer[] = [];
const byTeam = new Map<string, EnginePlayer[]>();
for (const [year, codes] of Object.entries(TEAMS)) {
  for (const country of codes) {
    const roster = (['C', '1B', 'SP'] as Slot[]).map((pos) => makePlayer({ positions: [pos], edition: Number(year), country }));
    players.push(...roster);
    byTeam.set(`${year}-${country}`, roster);
  }
}
const data: GameData = { players, byTeam, editionTeams: TEAMS, countries: new Map() };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 12, 9, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('newSession', () => {
  test('without a seed: the daily deals daily-<today>, free and hard deal a fresh seed of their mode', () => {
    expect(newSession(data, 'daily', true).seed).toBe('daily-2026-10-12');
    expect(newSession(data, 'free', true).seed).toMatch(/^free-[0-9a-z]+-[0-9a-z]+$/);
    expect(newSession(data, 'hard', true).seed).toMatch(/^hard-[0-9a-z]+-[0-9a-z]+$/);
  });

  test("with a challenge's seed: that seed, its first roll, today's day, and the mode and scoring asked for", () => {
    const session = newSession(data, 'free', false, 'daily-2026-10-01');
    expect(session.seed).toBe('daily-2026-10-01');
    expect(session.roll).toEqual(rollBase('daily-2026-10-01', 0, TEAMS));
    expect(session.mode).toBe('free');
    expect(session.scored).toBe(false);
    expect(session.day).toBe('2026-10-12');
    const hard = newSession(data, 'hard', true, 'hard-mg5x2k7q-8f3k1z');
    expect(hard.roll).toEqual(rollBase('hard-mg5x2k7q-8f3k1z', 0, TEAMS));
    expect(hard.rival).toBeUndefined();
  });
});
