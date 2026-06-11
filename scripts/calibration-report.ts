// Prints where the Monte Carlo calibration actually landed, plus a real-data
// "best draftable lineup" check. Diagnostic only — the binding assertions live
// in src/engine/montecarlo.test.ts.
import { readFileSync } from 'node:fs';
import { simulateRun } from '../src/engine/simulate.js';
import { categoryMeans, teamRating } from '../src/engine/teamRating.js';
import type { EnginePlayer, Slot } from '../src/engine/types.js';
import { isEligible } from '../src/engine/positions.js';

const mk = (c: number, p: number, s: number, d: number, cl: number): EnginePlayer[] =>
  Array.from({ length: 9 }, (_, i) => ({
    id: `x${i}`, personKey: `k${i}`, name: 'X', edition: 2023, country: 'VEN',
    positions: ['1B'] as Slot[], rating: 80, contact: c, power: p, speed: s, defense: d, clutch: cl,
  }));

const rate = (lu: EnginePlayer[], n = 20000) => {
  let w = 0;
  for (let i = 0; i < n; i++) if (simulateRun(lu, `mc-${i}`).outcome === 'invicto') w++;
  return w / n;
};

const elite = mk(85, 88, 62, 60, 85);
const casual = mk(72, 70, 56, 58, 72);
const gated = mk(95, 95, 95, 95, 40);
console.log('synthetic elite : team', teamRating(elite).toFixed(1), ' 7-0 rate', rate(elite));
const wins: number[] = [];
for (let i = 0; i < 20000; i++) wins.push(simulateRun(casual, `mc-${i}`).wins);
wins.sort((a, b) => a - b);
console.log('synthetic casual: team', teamRating(casual).toFixed(1), ' median wins', wins[10000], ' mean', (wins.reduce((a, b) => a + b) / 20000).toFixed(2));
console.log('synthetic gated : team', teamRating(gated).toFixed(1), ' 7-0 rate', rate(gated));

// Best draftable lineup from the real pool (greedy by subrating sum).
const data: EnginePlayer[] = JSON.parse(readFileSync('public/data/players.json', 'utf-8')).players;
const used = new Set<string>();
const lineup: EnginePlayer[] = [];
for (const slot of ['C', 'SS', 'CF', '2B', '3B', '1B', 'LF', 'RF', 'DH'] as Slot[]) {
  const best = data
    .filter((p) => !used.has(p.personKey) && isEligible(p.positions, slot))
    .sort((a, b) => b.contact + b.power + b.speed + b.defense + b.clutch - (a.contact + a.power + a.speed + a.defense + a.clutch))[0];
  used.add(best.personKey);
  lineup.push(best);
}
console.log('\nreal best-ish lineup:', lineup.map((p) => `${p.name} '${String(p.edition).slice(2)}`).join(', '));
const means = categoryMeans(lineup);
console.log('cat means:', Object.fromEntries(Object.entries(means).map(([k, v]) => [k, Math.round(v)])));
console.log('team', teamRating(lineup).toFixed(1), ' 7-0 rate', rate(lineup));
