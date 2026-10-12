import { describe, expect, test } from 'vitest';
import { SLOTS } from '../engine/positions';
import { scheduleOpponents, simulateRun, winChance } from '../engine/simulate';
import { categoryRatings, ratingFromCategories, teamRating } from '../engine/teamRating';
import { lineupWithMeans, makePlayer } from '../engine/test-helpers';
import type { EnginePlayer, LineupSlots, RunResult } from '../engine/types';
import { atLeast, bracketOdds, contribution, gate, leverage, replacementPlayer, scoutReport, verdict } from './scout';

// A small synthetic pool: three catchers, a first baseman, a center fielder, two starters and a reliever.
const POOL: EnginePlayer[] = [
  makePlayer({ positions: ['C'], rating: 60, contact: 50, power: 40, speed: 30, defense: 70, clutch: 55 }),
  makePlayer({ positions: ['C'], rating: 70, contact: 60, power: 45, speed: 35, defense: 80, clutch: 65 }),
  makePlayer({ positions: ['C', '1B'], rating: 80, contact: 70, power: 60, speed: 25, defense: 60, clutch: 75 }),
  makePlayer({ positions: ['1B'], rating: 90, contact: 85, power: 90, speed: 40, defense: 50, clutch: 80 }),
  makePlayer({ positions: ['CF'], rating: 75, contact: 70, power: 50, speed: 90, defense: 85, clutch: 60 }),
  makePlayer({ positions: ['SP'], rating: 82, contact: 10, power: 10, speed: 30, defense: 40, clutch: 70 }),
  makePlayer({ positions: ['SP', 'RP'], rating: 68, contact: 10, power: 10, speed: 30, defense: 40, clutch: 60 }),
  makePlayer({ positions: ['RP'], rating: 74, contact: 10, power: 10, speed: 30, defense: 40, clutch: 50 }),
];

// Every slot covered, as in the real data, for the full report.
const FULL_POOL: EnginePlayer[] = [
  ...POOL,
  ...(['2B', '3B', 'SS', 'CL'] as const).map((slot) => makePlayer({ positions: [slot], rating: 72, contact: 66, power: 58, speed: 60, defense: 70, clutch: 64 })),
];

const attrs = (p: EnginePlayer) => [p.rating, p.contact, p.power, p.speed, p.defense, p.clutch];

describe('replacementPlayer', () => {
  test('takes the median of each attribute over the records eligible at the slot', () => {
    expect(attrs(replacementPlayer(POOL, 'C'))).toEqual([70, 60, 45, 30, 70, 65]);
    // DH takes every hitter, the catchers too.
    expect(attrs(replacementPlayer(POOL, 'DH'))).toEqual([75, 70, 50, 35, 70, 65]);
    // SP needs a true starter: two of them, so the median is the mean of both. RP takes any pitcher.
    expect(replacementPlayer(POOL, 'SP').rating).toBe(75);
    expect(replacementPlayer(POOL, 'RP').rating).toBe(74);
    // A corner outfield slot takes the center fielder.
    expect(replacementPlayer(POOL, 'LF').speed).toBe(90);
  });

  test('is computed once per pool and slot', () => {
    expect(replacementPlayer(POOL, 'C')).toBe(replacementPlayer(POOL, 'C'));
    expect(replacementPlayer([...POOL], 'C')).not.toBe(replacementPlayer(POOL, 'C'));
  });
});

describe('contribution', () => {
  test('a player equal to the replacement adds 0', () => {
    const lineup = lineupWithMeans(72, 70, 56, 58, 72, 70);
    lineup.C = { ...replacementPlayer(POOL, 'C'), id: 'twin', personKey: 'twin' };
    expect(contribution(lineup, 'C', POOL)).toBe(0);
  });

  test('is the team rating lost when the slot goes to the replacement', () => {
    const lineup = lineupWithMeans(72, 70, 56, 58, 72, 70);
    const without = teamRating({ ...lineup, SP: replacementPlayer(POOL, 'SP') });
    expect(contribution(lineup, 'SP', POOL)).toBe(teamRating(lineup) - without);
    lineup.SP = makePlayer({ positions: ['SP'], rating: 95 });
    expect(contribution(lineup, 'SP', POOL)).toBeGreaterThan(0);
  });
});

describe('gate and leverage', () => {
  const values = categoryRatings(lineupWithMeans(72, 70, 56, 58, 72, 70));

  test('the gate is the lowest category', () => {
    expect(gate(values)).toBe('speed');
    expect(gate({ ...values, pitching: 40 })).toBe('pitching');
  });

  test('compares ten more points at the gate with ten more in the strongest other category', () => {
    const lev = leverage(values);
    expect(lev).toEqual({
      gate: 'speed',
      best: 'contact',
      now: ratingFromCategories(values),
      gateUp: ratingFromCategories({ ...values, speed: 66 }),
      bestUp: ratingFromCategories({ ...values, contact: 82 }),
    });
    expect(lev.gateUp).toBeGreaterThan(lev.bestUp);
  });

  test('with six equal categories the strongest other category is still a different one', () => {
    const lev = leverage(categoryRatings(lineupWithMeans(70, 70, 70, 70, 70, 70)));
    expect(lev.best).not.toBe(lev.gate);
  });
});

describe('verdict', () => {
  test('70% or more is bad luck, 40% up to 70% a coin flip, under 40% the underdog', () => {
    expect(verdict(0.95)).toBe('luck');
    expect(verdict(0.7)).toBe('luck');
    expect(verdict(0.6999)).toBe('coin');
    expect(verdict(0.4)).toBe('coin');
    expect(verdict(0.3999)).toBe('underdog');
  });
});

describe('atLeast (Poisson-binomial)', () => {
  test('matches the binomial when every game has the same chance', () => {
    const p = 0.8;
    expect(atLeast(3, [p, p, p, p])).toBeCloseTo(4 * p ** 3 * (1 - p) + p ** 4, 12);
    expect(atLeast(0, [p, p, p, p])).toBe(1);
    expect(atLeast(5, [p, p, p, p])).toBe(0);
  });

  test('handles a different chance per game', () => {
    const [a, b, c] = [0.9, 0.5, 0.2];
    expect(atLeast(2, [a, b, c])).toBeCloseTo(a * b * (1 - c) + a * (1 - b) * c + (1 - a) * b * c + a * b * c, 12);
  });
});

describe('bracketOdds', () => {
  test('reads the unrounded schedule: one chance per scheduled game', () => {
    const team = 78.4;
    const odds = bracketOdds(team, 'daily-2026-10-11');
    const schedule = scheduleOpponents('daily-2026-10-11');
    expect(odds.chances).toEqual(schedule.map((s) => winChance(team - s.opponent.rating)));
    const [p1, p2, p3, p4, qf, sf, final] = odds.chances;
    expect(odds.title).toBeCloseTo(atLeast(3, [p1, p2, p3, p4]) * qf * sf * final, 12);
    expect(odds.invicto).toBeCloseTo(p1 * p2 * p3 * p4 * qf * sf * final, 12);
  });

  test('over 20,000 seeds the predicted 7-0 and title odds of a fixed lineup match the simulated rates', () => {
    const lineup = lineupWithMeans(85, 88, 62, 60, 85, 84);
    const team = teamRating(lineup);
    const N = 20000;
    let invicto = 0;
    let titles = 0;
    let predictedInvicto = 0;
    let predictedTitle = 0;
    for (let i = 0; i < N; i++) {
      const seed = `odds-${i}`;
      const run = simulateRun(lineup, seed);
      if (run.outcome === 'invicto') invicto++;
      if (run.outcome === 'invicto' || run.outcome === 'campeon') titles++;
      const odds = bracketOdds(team, seed);
      predictedInvicto += odds.invicto;
      predictedTitle += odds.title;
    }
    expect(Math.abs(predictedInvicto / N - invicto / N)).toBeLessThan(0.005);
    expect(Math.abs(predictedTitle / N - titles / N)).toBeLessThan(0.01);
  }, 20_000);
});

describe('scoutReport', () => {
  const lineup: LineupSlots = lineupWithMeans(72, 70, 56, 58, 72, 70);
  const seed = 'daily-2026-06-11'; // the golden run: 3-2, lost to COL in pool and to USA in the quarterfinal
  const run: RunResult = simulateRun(lineup, seed);
  const report = scoutReport(lineup, run, seed, FULL_POOL);

  test('carries the team rating, the six categories and the leverage line', () => {
    expect(report.ovr).toBe(run.teamRating);
    expect(report.categories).toEqual(categoryRatings(lineup));
    expect(report.leverage).toEqual(leverage(categoryRatings(lineup)));
  });

  test('explains each loss with the chance before the dice and its verdict', () => {
    const schedule = scheduleOpponents(seed);
    expect(report.losses.map((l) => l.country)).toEqual(['COL', 'USA']);
    for (const loss of report.losses) {
      const opponent = schedule.find((s) => s.stage === loss.stage)!.opponent;
      expect(loss.chance).toBe(winChance(run.teamRating - opponent.rating));
      expect(loss.verdict).toBe(verdict(Math.round(loss.chance * 100) / 100));
    }
  });

  test('judges a loss on the whole percent it shows: 69.6% reads 70% and is bad luck', () => {
    // The final against a 90: find the team rating that makes it a 69.6% game.
    let team = 90;
    while (winChance(team - 90) < 0.696) team += 0.01;
    const lost: RunResult = { ...run, teamRating: team, games: [{ ...run.games[0], stage: 'final', win: false }] };
    const [loss] = scoutReport(lineup, lost, seed, FULL_POOL).losses;
    expect(loss.chance).toBeLessThan(0.7);
    expect(Math.round(loss.chance * 100)).toBe(70);
    expect(loss.verdict).toBe('luck');
  });

  test('names the slots that add the most and the least over the replacement', () => {
    const deltas = SLOTS.map((slot) => contribution(lineup, slot, FULL_POOL));
    expect(report.best.delta).toBe(Math.max(...deltas));
    expect(report.weakest.delta).toBe(Math.min(...deltas));
    expect(contribution(lineup, report.best.slot, FULL_POOL)).toBe(report.best.delta);
    expect(contribution(lineup, report.weakest.slot, FULL_POOL)).toBe(report.weakest.delta);
  });

  test('gives the odds of this bracket', () => {
    const odds = bracketOdds(run.teamRating, seed);
    expect(report.title).toBe(odds.title);
    expect(report.invicto).toBe(odds.invicto);
  });
});
