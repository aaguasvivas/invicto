import { describe, expect, test } from 'vitest';
import {
  CAL_A, CAL_B, CATEGORIES, categoryBlend, categoryMeans, categoryRatings, ratingFromCategories, softMin, teamRating, type Category,
} from './teamRating';
import { lineupWithMeans, makePlayer } from './test-helpers';
import type { LineupSlots } from './types';

describe('categoryMeans', () => {
  test('averages each subrating across the lineup', () => {
    const lineup = [
      makePlayer({ contact: 80, power: 60, speed: 40, defense: 70, clutch: 50 }),
      makePlayer({ contact: 60, power: 80, speed: 60, defense: 50, clutch: 70 }),
    ];
    expect(categoryMeans(lineup)).toEqual({ contact: 70, power: 70, speed: 50, defense: 60, clutch: 60 });
  });
});

describe('softMin', () => {
  test('equals the value when all inputs are equal', () => {
    expect(softMin([70, 70, 70, 70, 70], [0.2, 0.2, 0.2, 0.2, 0.2])).toBeCloseTo(70, 5);
  });

  test('one terrible category drags the blend well below the arithmetic mean', () => {
    const blend = softMin([95, 95, 95, 95, 40], [0.2, 0.2, 0.2, 0.2, 0.2]);
    const mean = (95 * 4 + 40) / 5; // 84
    expect(blend).toBeLessThan(mean - 8);
    expect(blend).toBeGreaterThan(40);
  });

  test('raising the weakest category raises the blend', () => {
    const w = [0.2, 0.2, 0.2, 0.2, 0.2];
    expect(softMin([95, 95, 95, 95, 50], w)).toBeGreaterThan(softMin([95, 95, 95, 95, 40], w));
  });
});

describe('teamRating', () => {
  test('stays within 1–99', () => {
    expect(teamRating(lineupWithMeans(99, 99, 99, 99, 99, 99))).toBeLessThanOrEqual(99);
    expect(teamRating(lineupWithMeans(1, 1, 1, 1, 1, 1))).toBeGreaterThanOrEqual(1);
  });

  test('a gated lineup rates clearly below a balanced lineup with the same mean', () => {
    const balanced = teamRating(lineupWithMeans(84, 84, 84, 84, 84, 84));
    const gated = teamRating(lineupWithMeans(95, 95, 95, 95, 40, 95));
    expect(gated).toBeLessThan(balanced - 5);
  });

  test('terrible pitching caps a monster offense', () => {
    const armed = teamRating(lineupWithMeans(85, 85, 85, 85, 85, 85));
    const armless = teamRating(lineupWithMeans(85, 85, 85, 85, 85, 40));
    expect(armless).toBeLessThan(armed - 5);
  });

  test('better players produce a better team', () => {
    expect(teamRating(lineupWithMeans(85, 88, 62, 60, 85, 82))).toBeGreaterThan(teamRating(lineupWithMeans(70, 68, 55, 56, 70, 68)));
  });
});

describe('categoryRatings', () => {
  test('returns the six category values: five hitter means and the mean pitcher rating', () => {
    const values = categoryRatings(lineupWithMeans(72, 70, 56, 58, 72, 81));
    expect(Object.keys(values)).toEqual([...CATEGORIES]);
    expect(values).toEqual({ contact: 72, power: 70, speed: 56, defense: 58, clutch: 72, pitching: 81 });
  });

  test('without pitchers, pitching is 50', () => {
    const lineup = lineupWithMeans(72, 70, 56, 58, 72, 81);
    delete lineup.SP;
    delete lineup.RP;
    delete lineup.CL;
    expect(categoryRatings(lineup).pitching).toBe(50);
  });

  test('without hitters, the hitter means come from whoever is in the lineup', () => {
    const lineup: LineupSlots = {
      SP: makePlayer({ positions: ['SP'], rating: 80, contact: 20, power: 30, speed: 40, defense: 50, clutch: 60 }),
      CL: makePlayer({ positions: ['CL'], rating: 70, contact: 40, power: 50, speed: 60, defense: 70, clutch: 80 }),
    };
    expect(categoryRatings(lineup)).toEqual({ contact: 30, power: 40, speed: 50, defense: 60, clutch: 70, pitching: 75 });
  });
});

describe('ratingFromCategories', () => {
  const lineups = [
    lineupWithMeans(72, 70, 56, 58, 72, 70),
    lineupWithMeans(85, 88, 62, 60, 85, 84),
    lineupWithMeans(95, 95, 95, 95, 40, 95),
    lineupWithMeans(1, 1, 1, 1, 1, 1),
    lineupWithMeans(99, 99, 99, 99, 99, 99),
  ];

  test('applied to categoryRatings, gives teamRating to the last bit', () => {
    for (const lineup of lineups) expect(ratingFromCategories(categoryRatings(lineup))).toBe(teamRating(lineup));
  });

  test('is the calibration line over the soft-min blend, which equals the value when all six agree', () => {
    const values = categoryRatings(lineupWithMeans(72, 70, 56, 58, 72, 70));
    expect(ratingFromCategories(values)).toBe(CAL_A + CAL_B * categoryBlend(values));
    expect(categoryBlend(categoryRatings(lineupWithMeans(70, 70, 70, 70, 70, 70)))).toBeCloseTo(70, 9);
  });

  test('the lowest category is the gate: ten points there are worth more than ten anywhere else', () => {
    const values = categoryRatings(lineupWithMeans(72, 70, 56, 58, 72, 70));
    const gate = CATEGORIES.reduce((low, c) => (values[c] < values[low] ? c : low));
    expect(gate).toBe('speed');
    const plusTen = (c: Category) => ratingFromCategories({ ...values, [c]: values[c] + 10 });
    for (const c of CATEGORIES.filter((c) => c !== gate)) expect(plusTen(gate)).toBeGreaterThan(plusTen(c));
  });
});
