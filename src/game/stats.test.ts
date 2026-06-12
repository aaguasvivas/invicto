import { describe, expect, test } from 'vitest';
import { percentileBeaten, rarestPick, topSharePct } from './stats';

describe('percentileBeaten', () => {
  // distribution: how many runs finished with each win count today (including yours)
  const dist = { 0: 5, 1: 10, 2: 20, 3: 25, 4: 20, 5: 10, 6: 7, 7: 3 }; // total 100

  test('counts strictly-worse runs against the total', () => {
    // 60 runs finished below 4 wins → beat 60 of 100
    expect(percentileBeaten(4, dist)).toBe(60);
  });

  test('a perfect run beats everyone else', () => {
    expect(percentileBeaten(7, dist)).toBe(97);
  });

  test('a winless run beats nobody', () => {
    expect(percentileBeaten(0, dist)).toBe(0);
  });

  test('returns null when you are the only run of the day', () => {
    expect(percentileBeaten(5, { 5: 1 })).toBeNull();
    expect(percentileBeaten(5, {})).toBeNull();
  });
});

describe('topSharePct', () => {
  test('is the share of runs at-or-above yours, floored at 1%', () => {
    const dist = { 2: 50, 5: 49, 7: 1 };
    expect(topSharePct(7, dist)).toBe(1);
    expect(topSharePct(5, dist)).toBe(50);
    expect(topSharePct(2, dist)).toBe(100);
  });
});

describe('rarestPick', () => {
  test('finds the lineup pick with the lowest pick share', () => {
    const picks = [
      { id: 'a', n: 90 },
      { id: 'b', n: 4 },
      { id: 'c', n: 30 },
    ];
    expect(rarestPick(picks, 100)).toEqual({ id: 'b', pct: 4 });
  });

  test('returns null with no data or tiny samples', () => {
    expect(rarestPick([], 100)).toBeNull();
    expect(rarestPick([{ id: 'a', n: 1 }], 1)).toBeNull();
  });
});
