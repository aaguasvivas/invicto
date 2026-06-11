import { describe, expect, test } from 'vitest';
import { simulateRun } from './simulate';
import { lineupWithMeans } from './test-helpers';

// Calibration targets from the spec:
//  - a roughly top-percentile drafted lineup goes 7-0 about 2–5% of the time
//  - a casually good lineup usually finishes 4-2 to 6-1
//  - gating: one terrible category caps the ceiling no matter how strong the rest

const N = 20000;

function rate7and0(lineup: ReturnType<typeof lineupWithMeans>): number {
  let perfect = 0;
  for (let i = 0; i < N; i++) {
    if (simulateRun(lineup, `mc-${i}`).outcome === 'invicto') perfect++;
  }
  return perfect / N;
}

describe('Monte Carlo calibration', () => {
  // Best realistically draftable lineup: elite bats, ordinary legs/gloves.
  const elite = lineupWithMeans(85, 88, 62, 60, 85);
  // A solid-but-casual draft.
  const casual = lineupWithMeans(72, 70, 56, 58, 72);
  // Four monster categories, one disaster (the gating hazard).
  const gated = lineupWithMeans(95, 95, 95, 95, 40);

  test('elite lineup goes 7-0 between 2% and 5% of the time', () => {
    const rate = rate7and0(elite);
    expect(rate).toBeGreaterThanOrEqual(0.02);
    expect(rate).toBeLessThanOrEqual(0.05);
  });

  test('casual lineup usually lands between 4-2 and 6-1', () => {
    const winCounts: number[] = [];
    for (let i = 0; i < N; i++) winCounts.push(simulateRun(casual, `mc-${i}`).wins);
    winCounts.sort((a, b) => a - b);
    const median = winCounts[Math.floor(N / 2)];
    expect(median).toBeGreaterThanOrEqual(4);
    expect(median).toBeLessThanOrEqual(6);
  });

  test('one 40-rated category caps the ceiling even with four 95s', () => {
    const eliteRate = rate7and0(elite);
    const gatedRate = rate7and0(gated);
    expect(gatedRate).toBeLessThan(eliteRate);
    expect(gatedRate).toBeLessThan(0.02);
  });
});
