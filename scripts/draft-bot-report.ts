// Drafts thousands of lineups with the real roll mechanics + a greedy bot, then
// reports the team-rating distribution and the 7-0 rate at the top percentiles.
// This is the honest reading of "a roughly top-percentile drafted lineup".
import { readFileSync } from 'node:fs';
import { applyPick, newDraft, openSlots, rollBase, rollRedraw, hasLegalPick } from '../src/engine/draft.js';
import { isEligible } from '../src/engine/positions.js';
import { simulateRun } from '../src/engine/simulate.js';
import { teamRating, categoryMeans } from '../src/engine/teamRating.js';
import type { EditionTeams, EnginePlayer, Slot } from '../src/engine/types.js';

const playersData: EnginePlayer[] = JSON.parse(readFileSync('public/data/players.json', 'utf-8')).players;
const editionsData = JSON.parse(readFileSync('public/data/editions.json', 'utf-8'));
const TEAMS: EditionTeams = Object.fromEntries(
  editionsData.editions.map((e: { year: number; teams: { code: string }[] }) => [e.year, e.teams.map((t) => t.code)]),
);
const byTeam = new Map<string, EnginePlayer[]>();
for (const p of playersData) {
  const key = `${p.edition}-${p.country}`;
  (byTeam.get(key) ?? byTeam.set(key, []).get(key)!).push(p);
}

const subSum = (p: EnginePlayer) => p.contact + p.power + p.speed + p.defense + p.clutch;
// Fill scarce slots first when a player can cover several.
const SCARCITY: Slot[] = ['C', 'CF', 'SS', '2B', '3B', 'LF', 'RF', '1B', 'DH'];

function draftBot(seed: string): EnginePlayer[] {
  let state = newDraft();
  for (let round = 0; round < 9; round++) {
    let roll = rollBase(seed, round, TEAMS);
    let roster = byTeam.get(`${roll.edition}-${roll.country}`) ?? [];
    for (let attempt = 1; !hasLegalPick(state, roster); attempt++) {
      roll = rollRedraw(seed, round, attempt, TEAMS);
      roster = byTeam.get(`${roll.edition}-${roll.country}`) ?? [];
    }
    const open = openSlots(state);
    let best: { p: EnginePlayer; slot: Slot } | null = null;
    for (const p of roster) {
      if (state.draftedPersons.includes(p.personKey)) continue;
      const slot = SCARCITY.filter((s) => open.includes(s)).find((s) => isEligible(p.positions, s));
      if (!slot) continue;
      if (!best || subSum(p) > subSum(best.p)) best = { p, slot };
    }
    state = applyPick(state, best!.p, best!.slot);
  }
  return Object.values(state.lineup) as EnginePlayer[];
}

const N = 3000;
const lineups: { rating: number; lineup: EnginePlayer[] }[] = [];
for (let i = 0; i < N; i++) {
  const lineup = draftBot(`bot-${i}`);
  lineups.push({ rating: teamRating(lineup), lineup });
}
lineups.sort((a, b) => a.rating - b.rating);
const pct = (q: number) => lineups[Math.floor(q * (N - 1))];
console.log('bot-draft team rating percentiles:');
for (const q of [0.05, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) console.log(`  p${q * 100}: ${pct(q).rating.toFixed(1)}`);

const rate7 = (lineup: EnginePlayer[], n = 10000) => {
  let w = 0;
  for (let i = 0; i < n; i++) if (simulateRun(lineup, `mc-${i}`).outcome === 'invicto') w++;
  return w / n;
};
for (const q of [0.5, 0.9, 0.95, 0.99]) {
  const { rating, lineup } = pct(q);
  console.log(`p${q * 100} lineup (team ${rating.toFixed(1)}): 7-0 rate ${rate7(lineup)}  means`, JSON.stringify(Object.fromEntries(Object.entries(categoryMeans(lineup)).map(([k, v]) => [k, Math.round(v)]))));
}
const medianWins: number[] = [];
const mid = pct(0.5).lineup;
for (let i = 0; i < 10000; i++) medianWins.push(simulateRun(mid, `mc-${i}`).wins);
medianWins.sort((a, b) => a - b);
console.log('p50 lineup median wins:', medianWins[5000]);
