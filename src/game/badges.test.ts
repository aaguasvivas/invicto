// evaluateBadges is pure: (lineup, run) → badge ids earned by THIS run.
// Persistence (localStorage) is thin glue and not under test here.

import { describe, expect, test } from 'vitest';
import { evaluateBadges } from './badges';
import { makePlayer } from '../engine/test-helpers';
import type { EnginePlayer, GameResult, LineupSlots, Outcome, RunResult, Slot, Stage } from '../engine/types';

const ALL_SLOTS: Slot[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'CL'];
const EDITIONS = [2006, 2009, 2013, 2017, 2023, 2026];
const COUNTRIES = ['DOM', 'VEN', 'PUR', 'USA', 'JPN', 'MEX', 'CUB', 'KOR', 'TPE', 'NED', 'ITA', 'PAN'];

function fullLineup(overrides: (slot: Slot, i: number) => Partial<EnginePlayer> = () => ({})): LineupSlots {
  const lineup: LineupSlots = {};
  ALL_SLOTS.forEach((slot, i) => {
    lineup[slot] = makePlayer({ positions: [slot], ...overrides(slot, i) });
  });
  return lineup;
}

function game(over: Partial<GameResult>): GameResult {
  return {
    stage: 'pool-1',
    opponent: { country: 'USA', rating: 80 },
    win: true,
    teamScore: 5,
    oppScore: 2,
    mercy: false,
    walkOff: false,
    flavorKey: 'win-normal',
    flavorVariant: 0,
    hero: null,
    ...over,
  };
}

/** A 7-game run; the final is won 5-1 unless overridden. */
function makeRun(outcome: Outcome, over: Partial<RunResult> = {}): RunResult {
  const stages: Stage[] = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'qf', 'sf', 'final'];
  const games = stages.map((s) => game({ stage: s, oppScore: s === 'final' ? 1 : 2 }));
  return { teamRating: 80, games, wins: 7, losses: 0, outcome, ...over };
}

describe('evaluateBadges', () => {
  test('invicto: earned on a 7-0 run, along with campeon', () => {
    const earned = evaluateBadges(fullLineup(), makeRun('invicto'));
    expect(earned).toContain('invicto');
    expect(earned).toContain('campeon');
  });

  test('invicto: not earned when the title came with a loss', () => {
    expect(evaluateBadges(fullLineup(), makeRun('campeon'))).not.toContain('invicto');
  });

  test('campeon: earned on campeon, not on subcampeon or eliminations', () => {
    expect(evaluateBadges(fullLineup(), makeRun('campeon'))).toContain('campeon');
    expect(evaluateBadges(fullLineup(), makeRun('subcampeon'))).not.toContain('campeon');
    expect(evaluateBadges(fullLineup(), makeRun('eliminated-sf'))).not.toContain('campeon');
  });

  test('matagigantes: won the tournament with at least 5 players rated under 60', () => {
    const scrappy = fullLineup((_slot, i) => ({ rating: i < 5 ? 55 : 75 }));
    expect(evaluateBadges(scrappy, makeRun('campeon'))).toContain('matagigantes');
    expect(evaluateBadges(scrappy, makeRun('invicto'))).toContain('matagigantes');
  });

  test('matagigantes: not earned with only 4 sub-60 players, nor without the title', () => {
    const fourWeak = fullLineup((_slot, i) => ({ rating: i < 4 ? 55 : 75 }));
    expect(evaluateBadges(fourWeak, makeRun('campeon'))).not.toContain('matagigantes');
    const fiveWeak = fullLineup((_slot, i) => ({ rating: i < 5 ? 55 : 75 }));
    expect(evaluateBadges(fiveWeak, makeRun('subcampeon'))).not.toContain('matagigantes');
  });

  test('sin_estrellas: won the tournament with no player rated 80 or above', () => {
    const noStars = fullLineup(() => ({ rating: 79 }));
    expect(evaluateBadges(noStars, makeRun('campeon'))).toContain('sin_estrellas');
  });

  test('sin_estrellas: a single 80+ player or a lost final disqualifies', () => {
    const oneStar = fullLineup((_slot, i) => ({ rating: i === 0 ? 80 : 70 }));
    expect(evaluateBadges(oneStar, makeRun('campeon'))).not.toContain('sin_estrellas');
    const noStars = fullLineup(() => ({ rating: 79 }));
    expect(evaluateBadges(noStars, makeRun('subcampeon'))).not.toContain('sin_estrellas');
  });

  test('una_sola_edicion: seven or more picks from one edition, any outcome', () => {
    // The other picks spread over the remaining editions, so 2009 is the only one with more than two.
    const from2009 = (n: number) => fullLineup((_slot, i) => ({ edition: i < n ? 2009 : EDITIONS.filter((y) => y !== 2009)[i % 5] }));
    expect(evaluateBadges(from2009(7), makeRun('eliminated-pool'))).toContain('una_sola_edicion');
    expect(evaluateBadges(from2009(6), makeRun('invicto'))).not.toContain('una_sola_edicion');
    expect(evaluateBadges(fullLineup(() => ({ edition: 2013 })), makeRun('eliminated-qf'))).toContain('una_sola_edicion');
  });

  test('vuelta_al_mundo: 12 picks from 12 different countries', () => {
    const world = fullLineup((_slot, i) => ({ country: COUNTRIES[i] }));
    expect(evaluateBadges(world, makeRun('eliminated-qf'))).toContain('vuelta_al_mundo');
    const repeat = fullLineup((_slot, i) => ({ country: COUNTRIES[i % 11] }));
    expect(evaluateBadges(repeat, makeRun('invicto'))).not.toContain('vuelta_al_mundo');
  });

  test('seis_editiones: at least one pick from each of the 6 editions', () => {
    const collector = fullLineup((_slot, i) => ({ edition: EDITIONS[i % 6] }));
    expect(evaluateBadges(collector, makeRun('eliminated-pool'))).toContain('seis_editiones');
    const missing2006 = fullLineup((_slot, i) => ({ edition: EDITIONS[1 + (i % 5)] }));
    expect(evaluateBadges(missing2006, makeRun('invicto'))).not.toContain('seis_editiones');
  });

  test('blanqueada_final: won the final with the opponent scoring 0', () => {
    const stages: Stage[] = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'qf', 'sf', 'final'];
    const shutoutFinal = makeRun('campeon', {
      games: stages.map((s) => game({ stage: s, oppScore: s === 'final' ? 0 : 2 })),
    });
    expect(evaluateBadges(fullLineup(), shutoutFinal)).toContain('blanqueada_final');
  });

  test('blanqueada_final: not earned when the final allows a run or is lost', () => {
    expect(evaluateBadges(fullLineup(), makeRun('campeon'))).not.toContain('blanqueada_final');
    const stages: Stage[] = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'qf', 'sf', 'final'];
    const lostFinal = makeRun('subcampeon', {
      games: stages.map((s) => game({ stage: s, win: s !== 'final', teamScore: 0, oppScore: s === 'final' ? 3 : 0 })),
    });
    expect(evaluateBadges(fullLineup(), lostFinal)).not.toContain('blanqueada_final');
  });

  test('lineup-collection badges need all 12 slots filled', () => {
    const partial: LineupSlots = { C: makePlayer({ positions: ['C'], edition: 2013 }) };
    const earned = evaluateBadges(partial, makeRun('eliminated-pool'));
    expect(earned).not.toContain('una_sola_edicion');
    expect(earned).not.toContain('vuelta_al_mundo');
  });
});
