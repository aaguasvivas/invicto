import { describe, expect, test } from 'vitest';
import { simulateRun } from './simulate';
import { lineupWithMeans } from './test-helpers';

const mid = () => lineupWithMeans(72, 70, 56, 58, 72);

describe('simulateRun', () => {
  test('same lineup and seed give identical results', () => {
    expect(simulateRun(mid(), 'daily-42')).toEqual(simulateRun(mid(), 'daily-42'));
  });

  test('different seeds give different results eventually', () => {
    const records = new Set<string>();
    for (let i = 0; i < 30; i++) records.add(`${simulateRun(mid(), `s-${i}`).wins}`);
    expect(records.size).toBeGreaterThan(1);
  });

  test('invariants hold across many seeds', () => {
    for (let i = 0; i < 500; i++) {
      const run = simulateRun(mid(), `inv-${i}`);
      const stages = run.games.map((g) => g.stage);
      const poolGames = run.games.filter((g) => g.stage.startsWith('pool'));
      const poolWins = poolGames.filter((g) => g.win).length;
      const knockout = run.games.filter((g) => !g.stage.startsWith('pool'));

      // All four pool games always play out.
      expect(poolGames).toHaveLength(4);
      expect(stages.slice(0, 4)).toEqual(['pool-1', 'pool-2', 'pool-3', 'pool-4']);

      // Advance on ≥3 pool wins, otherwise the run ends in pool play.
      if (poolWins < 3) {
        expect(knockout).toHaveLength(0);
        expect(run.outcome).toBe('eliminated-pool');
      } else {
        expect(knockout.length).toBeGreaterThanOrEqual(1);
        expect(knockout[0].stage).toBe('qf');
      }

      // Any knockout loss ends the run immediately.
      for (let k = 0; k < knockout.length; k++) {
        if (!knockout[k].win) expect(k).toBe(knockout.length - 1);
      }

      // Outcome classification.
      const total = run.games.length;
      if (run.outcome === 'invicto') {
        expect(run.wins).toBe(7);
        expect(run.losses).toBe(0);
      }
      if (run.outcome === 'campeon') {
        expect(run.games[total - 1].stage).toBe('final');
        expect(run.games[total - 1].win).toBe(true);
        expect(run.losses).toBeGreaterThanOrEqual(1);
      }
      if (run.outcome === 'subcampeon') {
        expect(run.games[total - 1].stage).toBe('final');
        expect(run.games[total - 1].win).toBe(false);
      }
      if (run.outcome === 'eliminated-sf') expect(run.games[total - 1].stage).toBe('sf');
      if (run.outcome === 'eliminated-qf') expect(run.games[total - 1].stage).toBe('qf');

      // Wins/losses tally matches the games.
      expect(run.wins).toBe(run.games.filter((g) => g.win).length);
      expect(run.losses).toBe(run.games.filter((g) => !g.win).length);

      // Scores are sane and consistent with the result.
      for (const g of run.games) {
        expect(g.teamScore).not.toBe(g.oppScore);
        expect(g.win).toBe(g.teamScore > g.oppScore);
        expect(Math.min(g.teamScore, g.oppScore)).toBeGreaterThanOrEqual(0);
        const margin = Math.abs(g.teamScore - g.oppScore);
        if (g.mercy) expect(margin).toBeGreaterThanOrEqual(10);
        if (g.walkOff) expect(margin).toBe(1);
        expect(g.flavorKey).toMatch(/^(win|loss)-(mercy|blowout|walkoff|close|normal)$/);
        expect(g.flavorKey.startsWith(g.win ? 'win' : 'loss')).toBe(true);
        expect(g.flavorVariant).toBeGreaterThanOrEqual(0);
        expect(g.opponent.country).toBeTruthy();
        expect(g.opponent.rating).toBeGreaterThan(0);
      }
    }
  });

  test('pool opponents are one minnow, two mids, one power by rating tier', () => {
    const run = simulateRun(mid(), 'tiers-1');
    const poolRatings = run.games.filter((g) => g.stage.startsWith('pool')).map((g) => g.opponent.rating).sort((a, b) => a - b);
    expect(poolRatings[0]).toBeLessThan(62); // minnow
    expect(poolRatings[3]).toBeGreaterThan(72); // power
  });
});
