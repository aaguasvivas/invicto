import { describe, expect, test } from 'vitest';
import { MIN_PUBLIC_SAMPLE, percentileBeaten, rarestPick, topSharePct } from './stats';

// A distribution counts the runs finished with each win count today, yours
// included (the server records a run before it answers with the day's stats).

describe('percentileBeaten', () => {
  const dist = { 0: 5, 1: 10, 2: 20, 3: 25, 4: 20, 5: 10, 6: 7, 7: 3 }; // total 100

  test('compares you with the other runs, and a tie counts half', () => {
    // 60 other runs below 4 wins, 19 others tied at 4: (60 + 9.5) / 99
    expect(percentileBeaten(4, dist)).toBe(70);
  });

  test('ties count half: the middle of three equal buckets is 50%', () => {
    expect(percentileBeaten(4, { 3: 10, 4: 10, 5: 10 })).toBe(50);
  });

  test('your own run is not in the denominator', () => {
    // all 24 other runs below a 7-0, no ties: 24 / 24
    expect(percentileBeaten(7, { 3: 24, 7: 1 })).toBe(100);
    // 97 below, 2 others tied at 7: (97 + 1) / 99
    expect(percentileBeaten(7, dist)).toBe(99);
  });

  test('the bottom run of a crowd beats only the half of its ties', () => {
    expect(percentileBeaten(0, dist)).toBe(2);
    expect(percentileBeaten(4, { 4: 200 })).toBe(50);
  });

  test(`is null below ${MIN_PUBLIC_SAMPLE} runs, so a quiet day shows no percent`, () => {
    expect(MIN_PUBLIC_SAMPLE).toBe(25);
    expect(percentileBeaten(5, { 5: 1 })).toBeNull();
    expect(percentileBeaten(5, {})).toBeNull();
    expect(percentileBeaten(7, { 3: 23, 7: 1 })).toBeNull(); // 24 runs
    expect(percentileBeaten(7, { 3: 24, 7: 1 })).not.toBeNull(); // 25 runs
  });
});

describe('topSharePct', () => {
  test('is the share of runs at or above yours, floored at 1%', () => {
    const dist = { 2: 50, 5: 49, 7: 1 };
    expect(topSharePct(7, dist)).toBe(1);
    expect(topSharePct(5, dist)).toBe(50);
  });

  test('is null above 50%: a share card never brags "Top 90%"', () => {
    expect(topSharePct(2, { 2: 50, 5: 49, 7: 1 })).toBeNull();
    expect(topSharePct(4, { 3: 10, 4: 10, 5: 10 })).toBeNull(); // 67%
    expect(topSharePct(4, { 4: 200 })).toBeNull(); // everybody tied
  });

  test(`is null below ${MIN_PUBLIC_SAMPLE} runs (a lone player is not "Top 100%")`, () => {
    expect(topSharePct(5, { 5: 1 })).toBeNull();
    expect(topSharePct(7, { 3: 23, 7: 1 })).toBeNull();
    expect(topSharePct(7, { 3: 24, 7: 1 })).toBe(4);
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

  test(`returns null with no data or under ${MIN_PUBLIC_SAMPLE} runs`, () => {
    expect(rarestPick([], 100)).toBeNull();
    expect(rarestPick([{ id: 'a', n: 1 }], 1)).toBeNull();
    expect(rarestPick([{ id: 'a', n: 1 }], 24)).toBeNull();
    expect(rarestPick([{ id: 'a', n: 1 }], 25)).toEqual({ id: 'a', pct: 4 });
  });
});
