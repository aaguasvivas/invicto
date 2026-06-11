// Prints where the Monte Carlo calibration actually landed, plus a real-data
// "best draftable lineup" check (12 slots: 9 hitters + SP/RP/CL). Diagnostic
// only — the binding assertions live in src/engine/montecarlo.test.ts.
import { readFileSync } from 'node:fs';
import { simulateRun } from '../src/engine/simulate.js';
import { teamRating } from '../src/engine/teamRating.js';
import { lineupWithMeans } from '../src/engine/test-helpers.js';
import type { EnginePlayer, LineupSlots, Slot } from '../src/engine/types.js';
import { isEligible, SLOTS } from '../src/engine/positions.js';

const rate = (lu: LineupSlots, n = 20000) => {
  let w = 0;
  for (let i = 0; i < n; i++) if (simulateRun(lu, `mc-${i}`).outcome === 'invicto') w++;
  return w / n;
};

const elite = lineupWithMeans(85, 88, 62, 60, 85, 84);
const casual = lineupWithMeans(72, 70, 56, 58, 72, 70);
const gated = lineupWithMeans(95, 95, 95, 95, 40, 95);
console.log('synthetic elite : team', teamRating(elite).toFixed(1), ' 7-0 rate', rate(elite));
const wins: number[] = [];
for (let i = 0; i < 20000; i++) wins.push(simulateRun(casual, `mc-${i}`).wins);
wins.sort((a, b) => a - b);
console.log('synthetic casual: team', teamRating(casual).toFixed(1), ' median wins', wins[10000], ' mean', (wins.reduce((a, b) => a + b) / 20000).toFixed(2));
console.log('synthetic gated : team', teamRating(gated).toFixed(1), ' 7-0 rate', rate(gated));

// Best draftable lineup from the real pool (greedy, scarce slots first).
const data: EnginePlayer[] = JSON.parse(readFileSync('public/data/players.json', 'utf-8')).players;
const used = new Set<string>();
const lineup: LineupSlots = {};
const FILL_ORDER: Slot[] = ['C', 'CF', 'SS', 'CL', 'SP', '2B', '3B', 'LF', 'RF', '1B', 'RP', 'DH'];
const value = (p: EnginePlayer, slot: Slot) =>
  slot === 'SP' || slot === 'RP' || slot === 'CL' ? p.rating * 5 : p.contact + p.power + p.speed + p.defense + p.clutch;
for (const slot of FILL_ORDER) {
  const best = data
    .filter((p) => !used.has(p.personKey) && isEligible(p.positions, slot))
    .sort((a, b) => value(b, slot) - value(a, slot))[0];
  used.add(best.personKey);
  lineup[slot] = best;
}
console.log('\nreal best-ish lineup:');
for (const slot of SLOTS) console.log(`  ${slot}: ${lineup[slot]!.name} '${String(lineup[slot]!.edition).slice(2)} (${lineup[slot]!.rating})`);
console.log('team', teamRating(lineup).toFixed(1), ' 7-0 rate', rate(lineup));
