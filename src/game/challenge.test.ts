// Challenge links. A code carries the seed, the sharer's 12 picks and the
// record they claim; the friend replays the same seed, so the same rolls and
// the same dice. These tests pin the codec on the real rosters, the links it
// must refuse, and the property the copy "only your draft decides" rests on.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { applyPick, hasLegalPick, newDraft, openSlots, rollBase, rollRedraw } from '../engine/draft';
import { isEligible, SLOTS } from '../engine/positions';
import { simulateRun } from '../engine/simulate';
import { lineupWithMeans } from '../engine/test-helpers';
import type { EditionTeams, EnginePlayer, LineupSlots, RunResult, Slot } from '../engine/types';
import { installDom, installStorage } from '../test/fakedom';
import {
  challengeKind, cleanNick, encodeChallenge, matchedPicks, ownRun, parseChallenge, rememberRun, rivalFrom, savedNick,
  saveNick, versus, type Rival,
} from './challenge';

const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const PLAYERS: EnginePlayer[] = readJson('public/data/players.json').players;
const TEAMS: EditionTeams = Object.fromEntries(
  (readJson('public/data/editions.json').editions as { year: number; teams: { code: string }[] }[]).map((e) => [e.year, e.teams.map((t) => t.code)]),
);
const BY_TEAM = new Map<string, EnginePlayer[]>();
for (const p of PLAYERS) {
  const key = `${p.edition}-${p.country}`;
  (BY_TEAM.get(key) ?? BY_TEAM.set(key, []).get(key)!).push(p);
}

const TODAY = '2026-10-12';
const PITCHERS: Slot[] = ['SP', 'RP', 'CL'];
const SCARCITY: Slot[] = ['C', 'CF', 'SS', 'CL', 'SP', '2B', '3B', 'LF', 'RF', '1B', 'RP', 'DH'];
const value = (p: EnginePlayer, slot: Slot) =>
  PITCHERS.includes(slot) ? p.rating * 5 : p.contact + p.power + p.speed + p.defense + p.clutch;

/**
 * The greedy bot of scripts/draft-bot-report.ts on the real rolls of a seed
 * (redraws included). rank 0 takes the best fit each round; a higher rank
 * settles for a worse one, so one seed yields lineups of different strength.
 */
function botDraft(seed: string, rank = 0): LineupSlots {
  let state = newDraft();
  for (let round = 0; round < 12; round++) {
    let roll = rollBase(seed, round, TEAMS);
    let roster = BY_TEAM.get(`${roll.edition}-${roll.country}`) ?? [];
    for (let attempt = 1; !hasLegalPick(state, roster); attempt++) {
      roll = rollRedraw(seed, round, attempt, TEAMS);
      roster = BY_TEAM.get(`${roll.edition}-${roll.country}`) ?? [];
    }
    const open = openSlots(state);
    const fits = roster
      .filter((p) => !state.draftedPersons.includes(p.personKey))
      .map((p) => ({ p, slot: SCARCITY.filter((s) => open.includes(s)).find((s) => isEligible(p.positions, s)) }))
      .filter((c): c is { p: EnginePlayer; slot: Slot } => c.slot !== undefined)
      .sort((a, b) => value(b.p, b.slot) - value(a.p, a.slot));
    const choice = fits[Math.min(rank, fits.length - 1)];
    state = applyPick(state, choice.p, choice.slot);
  }
  return state.lineup;
}

/** Seeds in the three shapes the game deals: free and hard (time and random parts in base 36) and past dailies. */
function seedFor(i: number): string {
  const time = (1_760_000_000_000 + i * 7_919_993).toString(36);
  const rand = ((i * 104_729) % 1e9).toString(36);
  if (i % 3 === 0) return `daily-2026-${String(6 + (i % 4)).padStart(2, '0')}-${String(11 + (i % 17)).padStart(2, '0')}`;
  return `${i % 3 === 1 ? 'free' : 'hard'}-${time}-${rand}`;
}

const ids = (lineup: LineupSlots | null) => (lineup ? SLOTS.map((s) => lineup[s]?.id) : null);
const sortedIds = [...PLAYERS.map((p) => p.id)].sort();
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const pickChars = (id: string) => {
  const i = sortedIds.indexOf(id);
  return B62[Math.floor(i / 62)] + B62[i % 62];
};
/** Replace the two characters of one pick in a code (picks start 5 characters after the dot). */
function withPick(code: string, slot: Slot, chars: string): string {
  const at = code.indexOf('.') + 5 + SLOTS.indexOf(slot) * 2;
  return code.slice(0, at) + chars + code.slice(at + 2);
}

describe('codec on the real rosters', () => {
  test('400 bot drafts round-trip, replay to the same run, and fit a 90-character link', async () => {
    installDom(['ja-JP']);
    installStorage();
    const { challengeUrl } = await import('../ui/share'); // the longest link: a /ja/ path
    let roundTrips = 0;
    let replays = 0;
    let longest = 0;
    for (let i = 0; i < 400; i++) {
      const seed = seedFor(i);
      const lineup = botDraft(seed, i % 4);
      const run = simulateRun(lineup, seed);
      const code = encodeChallenge(seed, lineup, run, PLAYERS);
      const rival = rivalFrom(code, PLAYERS, TODAY);
      if (rival && JSON.stringify(ids(rival.lineup)) === JSON.stringify(ids(lineup))) roundTrips++;
      if (rival?.run && JSON.stringify(simulateRun(rival.lineup!, rival.seed)) === JSON.stringify(run) && JSON.stringify(rival.run) === JSON.stringify(run)) replays++;
      longest = Math.max(longest, challengeUrl(code)!.length);
    }
    expect(roundTrips).toBe(400);
    expect(replays).toBe(400);
    expect(longest).toBeLessThanOrEqual(90);
    for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage']) Reflect.deleteProperty(globalThis, name);
  });

  test('the code reads seed.fp pattern picks: the record shows before the rosters load', () => {
    const seed = 'free-mg5x2k7q-8f3k1z';
    const lineup = botDraft(seed);
    const run = simulateRun(lineup, seed);
    const code = encodeChallenge(seed, lineup, run, PLAYERS);
    expect(code).toMatch(/^free-mg5x2k7q-8f3k1z\.[0-9a-z]{4}[0-9A-Za-z]{24}$/);
    const parsed = parseChallenge(code, TODAY)!;
    expect(parsed.seed).toBe(seed);
    expect(parsed.wins).toEqual(run.games.map((g) => g.win));
    expect(parsed.nick).toBeNull();
  });

  test('every roster id fits two base-62 characters', () => {
    expect(new Set(sortedIds).size).toBe(sortedIds.length);
    expect(sortedIds.length).toBeLessThanOrEqual(62 * 62);
  });
});

describe('links that are refused (an invalid link is ignored)', () => {
  const seed = 'daily-2026-10-01';
  const lineup = botDraft(seed);
  const code = encodeChallenge(seed, lineup, simulateRun(lineup, seed), PLAYERS);

  test('a well-formed link resolves', () => {
    expect(rivalFrom(code, PLAYERS, TODAY)?.lineup).not.toBeNull();
  });

  test.each([
    ['an unknown mode', code.replace('daily-2026-10-01', 'weekly-2026-10-01')],
    ['a seed in capitals', 'FREE-MG5X2K7Q-8F3K1Z' + code.slice(code.indexOf('.'))],
    ['a date that does not exist', code.replace('2026-10-01', '2026-02-30')],
    ['a daily before the first one', code.replace('2026-10-01', '2026-06-10')],
    ['a missing dot', code.replace('.', '')],
    ['a short code', code.slice(0, -2)],
    ['a long code', code + 'a'],
    ['a pick that is not base 62', withPick(code, 'C', '-_')],
    ['an empty string', ''],
  ])('%s', (_, bad) => {
    expect(parseChallenge(bad, TODAY)).toBeNull();
  });

  test('a daily later than today', () => {
    const later = encodeChallenge('daily-2026-10-13', lineup, simulateRun(lineup, 'daily-2026-10-13'), PLAYERS);
    expect(parseChallenge(later, TODAY)).toBeNull();
    expect(parseChallenge(later, '2026-10-13')).not.toBeNull();
  });

  test('a pattern no tournament can produce', () => {
    // 1 then the bits: 2 pool wins in 4 games ends the run, so a fifth game is impossible.
    const fifthGameAfterElimination = (0b1_0011_1).toString(36).padStart(2, '0');
    const at = code.indexOf('.') + 3;
    expect(parseChallenge(code.slice(0, at) + fifthGameAfterElimination + code.slice(at + 2), TODAY)).toBeNull();
    // A knockout win that is not the final must be followed by the next game.
    const stopsAfterQfWin = (0b1_1110_1).toString(36).padStart(2, '0');
    expect(parseChallenge(code.slice(0, at) + stopsAfterQfWin + code.slice(at + 2), TODAY)).toBeNull();
  });

  test('an unknown id', () => {
    expect(rivalFrom(withPick(code, 'C', 'zz'), PLAYERS, TODAY)).toBeNull();
  });

  test('a pick in a slot he cannot play', () => {
    expect(rivalFrom(withPick(withPick(code, 'C', pickChars(lineup.SP!.id)), 'SP', pickChars(lineup.C!.id)), PLAYERS, TODAY)).toBeNull();
  });

  test('the same man twice', () => {
    expect(rivalFrom(withPick(code, 'RF', pickChars(lineup.LF!.id)), PLAYERS, TODAY)).toBeNull();
  });
});

describe('links from other rosters keep only the claimed record', () => {
  const seed = 'free-mg5x2k7q-8f3k1z';
  const lineup = botDraft(seed);
  const run = simulateRun(lineup, seed);

  test('a roster rebuild (the fingerprint differs) drops the lineup but keeps the record', () => {
    const code = encodeChallenge(seed, lineup, run, PLAYERS);
    const rebuilt = PLAYERS.filter((p) => p.id !== sortedIds[0]); // one record merged away
    const rival = rivalFrom(code, rebuilt, TODAY)!;
    expect(rival.lineup).toBeNull();
    expect(rival.run).toBeNull();
    expect(rival.wins).toEqual(run.games.map((g) => g.win));
  });

  test('a claimed record the replay does not reproduce drops the lineup too', () => {
    // Same ids, new ratings: the replay plays out differently.
    const code = encodeChallenge(seed, lineup, run, PLAYERS);
    const rerated = PLAYERS.map((p) => (Object.values(lineup).includes(p) ? { ...p, rating: 20, contact: 20, power: 20, speed: 20, defense: 20, clutch: 20 } : p));
    const rival = rivalFrom(code, rerated, TODAY)!;
    expect(rival.lineup).toBeNull();
    expect(rival.wins).toEqual(run.games.map((g) => g.win));
  });
});

describe('nicknames', () => {
  test('control and direction-override characters go, spaces collapse, 12 characters at most', () => {
    expect(cleanNick('  Ana‮  María\u0007 ')).toBe('Ana María');
    expect(cleanNick('⁦Luis⁩')).toBe('Luis');
    expect(cleanNick('Francisco José Rodríguez')).toBe('Francisco Jo');
    expect(cleanNick('大谷翔平ファン')).toBe('大谷翔平ファン');
    expect(cleanNick('\u0000‏')).toBe('');
  });

  test('travel after a ~, percent-encoded, and come back clean', () => {
    const seed = 'hard-mg5x2k7q-8f3k1z';
    const lineup = botDraft(seed);
    const run = simulateRun(lineup, seed);
    const code = encodeChallenge(seed, lineup, run, PLAYERS, 'José ~ 野球');
    expect(code).toContain('~Jos%C3%A9%20~%20%E9%87%8E%E7%90%83');
    expect(parseChallenge(code, TODAY)!.nick).toBe('José ~ 野球');
    // Some apps hand the fragment over decoded; a stray % is kept as typed.
    expect(parseChallenge(`${code.split('~')[0]}~Ana 100%`, TODAY)!.nick).toBe('Ana 100%');
    expect(parseChallenge(`${code.split('~')[0]}~‮evil`, TODAY)!.nick).toBe('evil');
    expect(parseChallenge(`${code.split('~')[0]}~`, TODAY)!.nick).toBeNull();
  });

  test('the nickname field is remembered on the device, cleaned', () => {
    installStorage();
    expect(savedNick()).toBe('');
    saveNick('  Ana‮ ');
    expect(savedNick()).toBe('Ana');
    Reflect.deleteProperty(globalThis, 'localStorage');
  });
});

describe('the same seed couples every lineup (the copy "only your draft decides")', () => {
  test('over 200 seeds x 10 lineups, a higher team rating never wins fewer games and never loses a game the lower one won', () => {
    const lineups = Array.from({ length: 10 }, (_, i) => botDraft(`free-coupling-${i}`, i % 5));
    let comparisons = 0;
    const inversions: string[] = [];
    for (let s = 0; s < 200; s++) {
      const seed = seedFor(s);
      const runs = lineups.map((l) => simulateRun(l, seed)).sort((a, b) => b.teamRating - a.teamRating);
      for (let hi = 0; hi < runs.length; hi++) {
        for (let lo = hi + 1; lo < runs.length; lo++) {
          if (runs[hi].teamRating === runs[lo].teamRating) continue;
          comparisons++;
          if (runs[hi].wins < runs[lo].wins) inversions.push(`${seed}: fewer wins`);
          for (const game of runs[lo].games) {
            const same = runs[hi].games.find((g) => g.stage === game.stage);
            if (game.win && !same?.win) inversions.push(`${seed}: lost ${game.stage}`);
          }
        }
      }
    }
    expect(comparisons).toBeGreaterThan(8000);
    expect(inversions).toEqual([]);
  });
});

describe('the verdict: wins first, then run differential', () => {
  const seed = 'free-mg5x2k7q-8f3k1z';
  const rivalOf = (run: RunResult, lineup: LineupSlots | null): Rival => ({
    code: 'x', name: 'Ana', seed, wins: run.games.map((g) => g.win), lineup, run: lineup ? run : null,
  });
  const strong = lineupWithMeans(90, 92, 70, 70, 90, 92);
  const weak = lineupWithMeans(60, 58, 50, 52, 60, 58);

  test('more wins beat fewer, whatever the scores', () => {
    const a = simulateRun(strong, seed);
    const b = simulateRun(weak, seed);
    expect(a.wins).toBeGreaterThan(b.wins);
    expect(versus(a, rivalOf(b, weak)).result).toBe('won');
    expect(versus(b, rivalOf(a, strong)).result).toBe('lost');
  });

  test('the same record goes to the run differential, and says so', () => {
    const diff = (r: RunResult) => r.games.reduce((sum, g) => sum + g.teamScore - g.oppScore, 0);
    const a = simulateRun(strong, seed);
    // A weaker team that wins the same games on this seed, by smaller margins.
    const twin = lineupWithMeans(80, 80, 65, 65, 80, 80);
    const b = simulateRun(twin, seed);
    expect(b.games.map((g) => g.win)).toEqual(a.games.map((g) => g.win));
    expect(diff(a)).toBeGreaterThan(diff(b));
    expect(versus(a, rivalOf(b, twin))).toEqual({ result: 'won', tiebreak: { us: diff(a), them: diff(b) } });
    expect(versus(b, rivalOf(a, strong))).toEqual({ result: 'lost', tiebreak: { us: diff(b), them: diff(a) } });
  });

  test('the same lineup is dead even', () => {
    const a = simulateRun(strong, seed);
    expect(versus(a, rivalOf(a, strong))).toEqual({ result: 'tie', tiebreak: null });
  });

  test('a record-only rival is judged on wins alone', () => {
    const a = simulateRun(strong, seed);
    expect(versus(a, rivalOf(a, null))).toEqual({ result: 'tie', tiebreak: null });
  });

  test('matched picks count the slots holding the same player', () => {
    const lineup = botDraft(seed);
    expect(matchedPicks(lineup, lineup)).toBe(12);
    expect(matchedPicks(lineup, { ...lineup, C: lineup.SP, SP: lineup.C })).toBe(10);
  });
});

describe('where a link leads', () => {
  test.each([
    ['free-abc-1', false, false, 'free'],
    ['hard-abc-1', false, false, 'hard'],
    [`daily-${TODAY}`, false, false, 'daily'],
    [`daily-${TODAY}`, true, false, 'dailyPlayed'],
    ['daily-2026-10-01', false, false, 'past'],
    ['daily-2026-10-01', true, false, 'past'],
    ['free-abc-1', false, true, 'compare'],
    [`daily-${TODAY}`, true, true, 'compare'],
    ['daily-2026-10-01', false, true, 'compare'],
  ] as const)('%s (played today: %s, in my runs: %s) -> %s', (seed, playedToday, mine, kind) => {
    expect(challengeKind(seed, TODAY, playedToday, mine)).toBe(kind);
  });
});

describe('my runs (invicto.mine)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  test('every finished run is kept by seed, the first of a seed wins, and only the last 30 seeds stay', () => {
    const lineup = botDraft('free-mine-0');
    rememberRun('daily-2026-10-01', lineup, '2026-10-01');
    rememberRun('daily-2026-10-01', botDraft('free-mine-1'), '2026-10-01'); // a practice replay of the same daily
    expect(ownRun('daily-2026-10-01')?.ids).toEqual(ids(lineup));
    for (let i = 0; i < 30; i++) rememberRun(`free-x-${i}`, lineup, '2026-10-02');
    expect(ownRun('daily-2026-10-01')).toBeNull();
    expect(ownRun('free-x-0')).not.toBeNull();
    expect(JSON.parse(store.get('invicto.mine')!)).toHaveLength(30);
  });

  test('a damaged list reads as empty', () => {
    store.set('invicto.mine', '{nope');
    expect(ownRun('free-x-0')).toBeNull();
    store.set('invicto.mine', '{"seed":"free-x-0"}');
    expect(ownRun('free-x-0')).toBeNull();
  });
});
