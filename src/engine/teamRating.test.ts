import { describe, expect, test } from 'vitest';
import { categoryMeans, softMin, teamRating } from './teamRating';
import { lineupWithMeans, makePlayer } from './test-helpers';

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
