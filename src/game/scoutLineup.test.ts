// The scout's lineup: the strongest lineup a fixed search builds from the 12
// base rolls a seed deals, with no rerolls, and the draft grade against it.
// These run on the real rosters, so they also pin that the dailies have a
// legal scout, that the search is the same on every call, and that it never
// loses to a simple greedy drafter on the same rolls.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyPick, hasLegalPick, newDraft, openSlots, rollBase, rollCountryReroll, rollRedraw } from '../engine/draft';
import { isEligible, SLOTS } from '../engine/positions';
import { simulateRun } from '../engine/simulate';
import { CAL_A, CAL_B, CATEGORIES, categoryRatings, ratingFromCategories, SOFTMIN_P, teamRating } from '../engine/teamRating';
import { lineupWithMeans, makePlayer } from '../engine/test-helpers';
import type { EditionTeams, EnginePlayer, LineupSlots, Slot } from '../engine/types';
import type { Country, GameData } from './data';
import { draftGrade, gradeDraft, MAX_PASSES, rerolledSlots, SCOUT_STARTS, scoutLineup, scoutSearch, softMinSum, type ScoutLineup } from './scout';

const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const PLAYERS: EnginePlayer[] = readJson('public/data/players.json').players;
const EDITIONS: { editions: { year: number; teams: { code: string }[] }[]; countries: Country[] } = readJson('public/data/editions.json');

/** The same shape data.ts builds from the two files. */
function gameData(players: EnginePlayer[], teams: EditionTeams): GameData {
  const byTeam = new Map<string, EnginePlayer[]>();
  for (const p of players) {
    const key = `${p.edition}-${p.country}`;
    (byTeam.get(key) ?? byTeam.set(key, []).get(key)!).push(p);
  }
  return { players, byTeam, editionTeams: teams, countries: new Map(EDITIONS.countries.map((c) => [c.code, c])) };
}

const DATA = gameData(PLAYERS, Object.fromEntries(EDITIONS.editions.map((e) => [e.year, e.teams.map((t) => t.code)])));
const rosterOf = (seed: string, round: number) => {
  const roll = rollBase(seed, round, DATA.editionTeams);
  return DATA.byTeam.get(`${roll.edition}-${roll.country}`) ?? [];
};

/** 30 dailies, every fourth day from launch day. */
const DAILIES = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2026, 5, 11 + 4 * i, 12);
  return `daily-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

// One search per daily, shared by the tests below (each takes a few milliseconds).
const SCOUTS = new Map<string, ScoutLineup>(DAILIES.map((seed) => [seed, scoutLineup(seed, DATA)!]));

const SCARCITY: Slot[] = ['C', 'CF', 'SS', 'CL', 'SP', '2B', '3B', 'LF', 'RF', '1B', 'RP', 'DH'];

/**
 * The chip-greedy bot: no rerolls, and each round it takes the legal player
 * with the highest rating chip (ties to the lower id) into his scarcest open
 * slot. A redraw deals it a new roll when nobody on the roster fits, as the
 * game does.
 */
function chipGreedy(seed: string): LineupSlots {
  let state = newDraft();
  for (let round = 0; round < 12; round++) {
    let roll = rollBase(seed, round, DATA.editionTeams);
    let roster = DATA.byTeam.get(`${roll.edition}-${roll.country}`) ?? [];
    for (let attempt = 1; !hasLegalPick(state, roster); attempt++) {
      roll = rollRedraw(seed, round, attempt, DATA.editionTeams);
      roster = DATA.byTeam.get(`${roll.edition}-${roll.country}`) ?? [];
    }
    const open = openSlots(state);
    const [choice] = roster
      .filter((p) => !state.draftedPersons.includes(p.personKey))
      .map((p) => ({ p, slot: SCARCITY.filter((s) => open.includes(s)).find((s) => isEligible(p.positions, s)) }))
      .filter((c): c is { p: EnginePlayer; slot: Slot } => c.slot !== undefined)
      .sort((a, b) => b.p.rating - a.p.rating || (a.p.id < b.p.id ? -1 : 1));
    state = applyPick(state, choice.p, choice.slot);
  }
  return state.lineup;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scoutLineup on 30 dailies', () => {
  test('every daily has a scout', () => {
    expect(DAILIES.filter((seed) => !SCOUTS.get(seed))).toEqual([]);
  });

  test('one pick per round, from that round’s base roster, at a slot he can play, and no person twice', () => {
    for (const seed of DAILIES) {
      const scout = SCOUTS.get(seed)!;
      expect(scout.slots).toHaveLength(12);
      expect(new Set(scout.slots).size).toBe(12);
      scout.slots.forEach((slot, round) => {
        const player = scout.lineup[slot]!;
        expect(rosterOf(seed, round), `${seed} round ${round}`).toContain(player);
        expect(isEligible(player.positions, slot), `${seed} ${player.name} at ${slot}`).toBe(true);
      });
      const persons = SLOTS.map((slot) => scout.lineup[slot]!.personKey);
      expect(new Set(persons).size).toBe(12);
    }
  });

  test('is deterministic: a second search on the same seed is deep-equal', () => {
    for (const seed of DAILIES) expect(scoutLineup(seed, DATA)).toEqual(SCOUTS.get(seed));
  });

  test('its OVR is the engine’s Team OVR and its record is simulateRun of its lineup on the seed', () => {
    for (const seed of DAILIES) {
      const scout = SCOUTS.get(seed)!;
      expect(scout.ovr).toBe(teamRating(scout.lineup));
      expect(scout.run).toEqual(simulateRun(scout.lineup, seed));
    }
  });

  test('is never weaker than the chip-greedy bot on the same rolls', () => {
    const behind = DAILIES.map((seed) => ({ seed, scout: SCOUTS.get(seed)!.ovr, bot: teamRating(chipGreedy(seed)) })).filter((r) => r.scout < r.bot);
    expect(behind).toEqual([]);
  });

  test('stops after at most 30 passes for each of its 3 starts, one pass per step', () => {
    for (const seed of DAILIES.slice(0, 10)) {
      const search = scoutSearch(seed, DATA);
      let steps = 0;
      let next = search.next();
      while (!next.done) {
        steps++;
        next = search.next();
      }
      expect(next.value).toEqual(SCOUTS.get(seed));
      expect(steps).toBe(next.value!.passes);
      expect(steps).toBeLessThanOrEqual(SCOUT_STARTS * MAX_PASSES);
    }
    expect(SCOUT_STARTS).toBe(3);
    expect(MAX_PASSES).toBe(30);
  });

  test('draws no randomness and reads no clock', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    scoutLineup(DAILIES[0], DATA);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
});

describe('scoutLineup on rolls that cannot fill a lineup', () => {
  test('is null when no round can take the mound', () => {
    const hitters = Array.from({ length: 20 }, () => makePlayer({ edition: 2023, country: 'VEN', positions: ['1B', 'LF'] }));
    expect(scoutLineup('free-x', gameData(hitters, { 2023: ['VEN'] }))).toBeNull();
  });
});

describe('the search objective', () => {
  test('is the soft-min sum Team OVR is computed from, so ranking by it ranks by Team OVR', () => {
    // The search compares sums without Math.pow (see scout.ts); this pins that the
    // sum and the exponent still match the engine's formula.
    for (const lineup of [lineupWithMeans(72, 70, 56, 58, 72, 70), lineupWithMeans(85, 88, 62, 60, 85, 84), lineupWithMeans(60, 75, 80, 55, 66, 81)]) {
      const values = categoryRatings(lineup);
      const sum = softMinSum(CATEGORIES.map((c) => values[c]));
      expect(CAL_A + CAL_B * sum ** (1 / SOFTMIN_P)).toBeCloseTo(ratingFromCategories(values), 9);
    }
  });
});

describe('draftGrade', () => {
  test('maps the gap to the scout, in OVR points, onto S to D', () => {
    expect([-0.1, 1.5, 3, 5, 5.1].map(draftGrade)).toEqual(['S', 'A', 'B', 'C', 'D']);
    expect(draftGrade(0)).toBe('S');
    expect(draftGrade(1.6)).toBe('B');
    expect(draftGrade(-4)).toBe('S');
  });

  test('judges the tenths the card shows, so float noise never moves a boundary', () => {
    expect(64.4 - 62.9).toBeGreaterThan(1.5); // 1.500000000000007
    expect(draftGrade(64.4 - 62.9)).toBe('A');
    expect(64.4 - 61.4).toBeGreaterThan(3);
    expect(draftGrade(64.4 - 61.4)).toBe('B');
    expect(64.4 - 59.4).toBeGreaterThan(5);
    expect(draftGrade(64.4 - 59.4)).toBe('C');
  });
});

describe('gradeDraft', () => {
  test('rounds both Team OVRs to the tenth before it grades them, and carries the scout’s record', () => {
    const scout = SCOUTS.get(DAILIES[0])!;
    const graded = gradeDraft(scout.ovr - 1.54, scout);
    const par = Math.round(scout.ovr * 10) / 10;
    expect(graded.par).toEqual({ ovr: par, wins: scout.run.wins, losses: scout.run.losses });
    expect(graded.ovr).toBe(Math.round((scout.ovr - 1.54) * 10) / 10);
    expect(graded.grade).toBe(draftGrade(par - graded.ovr));
    expect(gradeDraft(scout.ovr, scout).grade).toBe('S');
    expect(gradeDraft(scout.ovr + 2, scout).grade).toBe('S');
  });
});

describe('rerolledSlots', () => {
  // daily-2026-06-11 deals VEN 2009 in rounds 0 and 2 (and DOM 2013 in rounds 3 and 9).
  const seed = DAILIES[0];
  const scout = SCOUTS.get(seed)!;
  const team = (round: number) => {
    const roll = rollBase(seed, round, DATA.editionTeams);
    return `${roll.country}${roll.edition}`;
  };

  test('a lineup drafted from the base rolls alone has none, a team dealt twice included', () => {
    expect(seed).toBe('daily-2026-06-11');
    expect([team(0), team(2)]).toEqual(['VEN2009', 'VEN2009']);
    expect(rerolledSlots(seed, scout.lineup, DATA.editionTeams)).toEqual([]);
  });

  test('names the slot whose pick came from a roll the scout never saw', () => {
    const round = 5;
    const slot = scout.slots[round];
    const rerolled = rollCountryReroll(seed, round, rollBase(seed, round, DATA.editionTeams), DATA.editionTeams);
    const pick = makePlayer({ edition: rerolled.edition, country: rerolled.country, positions: [slot] });
    expect(rerolledSlots(seed, { ...scout.lineup, [slot]: pick }, DATA.editionTeams)).toEqual([slot]);
  });

  test('a team covers as many picks as it was dealt: a third VEN 2009 pick marks one of the three', () => {
    const round = 1;
    expect(team(round)).not.toBe('VEN2009');
    const slot = scout.slots[round];
    const pick = makePlayer({ edition: 2009, country: 'VEN', positions: [slot] });
    const marked = rerolledSlots(seed, { ...scout.lineup, [slot]: pick }, DATA.editionTeams);
    expect(marked).toHaveLength(1);
    expect([scout.slots[0], scout.slots[1], scout.slots[2]]).toContain(marked[0]);
  });
});
