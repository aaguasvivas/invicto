// The scouting report on the result screen: why the run went the way it did,
// read from the engine's own numbers after the run. Pure computation from the
// lineup, the RunResult and the roster data; it draws nothing, so the seeded
// runs never change.
//
// - Each player's contribution: the team rating he adds over a replacement
//   (the per-attribute median of every record eligible at his slot).
// - The gate: the lowest of the six categories, the one the soft minimum
//   punishes, and what ten more points there buy compared with ten more in
//   the strongest other category.
// - Each game's chance before the dice (winChance on the unrounded schedule),
//   a verdict per loss, and the title and 7-0 odds of this bracket.

import { isEligible, SLOTS } from '../engine/positions';
import { scheduleOpponents, winChance } from '../engine/simulate';
import { CATEGORIES, categoryRatings, ratingFromCategories, teamRating, type Category } from '../engine/teamRating';
import type { EnginePlayer, LineupSlots, RunResult, Slot, Stage } from '../engine/types';

const ATTRIBUTES = ['rating', 'contact', 'power', 'speed', 'defense', 'clutch'] as const;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const replacements = new WeakMap<readonly EnginePlayer[], Map<Slot, EnginePlayer>>();

/** A typical player at this slot: the median of each attribute over the records eligible there. Cached per pool. */
export function replacementPlayer(players: readonly EnginePlayer[], slot: Slot): EnginePlayer {
  let bySlot = replacements.get(players);
  if (!bySlot) replacements.set(players, (bySlot = new Map()));
  let player = bySlot.get(slot);
  if (!player) {
    const eligible = players.filter((p) => isEligible(p.positions, slot));
    player = { id: `replacement-${slot}`, personKey: `replacement-${slot}`, name: '', edition: 0, country: '', positions: [slot] } as EnginePlayer;
    for (const attr of ATTRIBUTES) player[attr] = median(eligible.map((p) => p[attr]));
    bySlot.set(slot, player);
  }
  return player;
}

/** The team rating this slot's player adds over the replacement (negative when he is below it). */
export function contribution(lineup: LineupSlots, slot: Slot, players: readonly EnginePlayer[]): number {
  return teamRating(lineup) - teamRating({ ...lineup, [slot]: replacementPlayer(players, slot) });
}

/** The lowest category (the first one on a tie). */
export function gate(values: Record<Category, number>): Category {
  return CATEGORIES.reduce((low, c) => (values[c] < values[low] ? c : low));
}

export interface Leverage {
  gate: Category;
  /** the strongest category other than the gate */
  best: Category;
  now: number;
  /** the team rating with ten more points at the gate */
  gateUp: number;
  /** the team rating with ten more points in `best` */
  bestUp: number;
}

export function leverage(values: Record<Category, number>): Leverage {
  const low = gate(values);
  const best = CATEGORIES.filter((c) => c !== low).reduce((high, c) => (values[c] > values[high] ? c : high));
  const plusTen = (c: Category) => ratingFromCategories({ ...values, [c]: values[c] + 10 });
  return { gate: low, best, now: ratingFromCategories(values), gateUp: plusTen(low), bestUp: plusTen(best) };
}

export type Verdict = 'luck' | 'coin' | 'underdog';

/** How to read a loss: a game you win 70% of the time or more was bad luck; under 40% you were the underdog. */
export function verdict(chance: number): Verdict {
  return chance >= 0.7 ? 'luck' : chance >= 0.4 ? 'coin' : 'underdog';
}

/** P(at least k wins) over games with different chances: the Poisson-binomial tail. */
export function atLeast(k: number, chances: number[]): number {
  // dist[w] = P(exactly w wins so far)
  let dist = [1];
  for (const p of chances) {
    const next = new Array<number>(dist.length + 1).fill(0);
    dist.forEach((q, w) => {
      next[w] += q * (1 - p);
      next[w + 1] += q * p;
    });
    dist = next;
  }
  return dist.slice(k).reduce((a, b) => a + b, 0);
}

export interface BracketOdds {
  /** one chance per scheduled game, in bracket order (pool 1 to 4, QF, SF, final) */
  chances: number[];
  /** 3 or more pool wins, then the QF, SF and final */
  title: number;
  invicto: number;
}

export function bracketOdds(team: number, seed: string): BracketOdds {
  const chances = scheduleOpponents(seed).map(({ opponent }) => winChance(team - opponent.rating));
  const knockout = chances.slice(4).reduce((a, b) => a * b, 1);
  return {
    chances,
    title: atLeast(3, chances.slice(0, 4)) * knockout,
    invicto: chances.reduce((a, b) => a * b, 1),
  };
}

export interface ScoutReport {
  ovr: number;
  categories: Record<Category, number>;
  leverage: Leverage;
  losses: { stage: Stage; country: string; chance: number; verdict: Verdict }[];
  best: { slot: Slot; delta: number };
  weakest: { slot: Slot; delta: number };
  title: number;
  invicto: number;
}

export function scoutReport(lineup: LineupSlots, run: RunResult, seed: string, players: readonly EnginePlayer[]): ScoutReport {
  const categories = categoryRatings(lineup);
  const odds = bracketOdds(run.teamRating, seed);
  const stages = scheduleOpponents(seed).map((s) => s.stage);
  const losses = run.games
    .filter((g) => !g.win)
    .map((g) => {
      const chance = odds.chances[stages.indexOf(g.stage)];
      // Judged on the whole percent the card shows, so "70%" never reads as a coin flip.
      return { stage: g.stage, country: g.opponent.country, chance, verdict: verdict(Math.round(chance * 100) / 100) };
    });
  const deltas = SLOTS.map((slot) => ({ slot, delta: contribution(lineup, slot, players) }));
  return {
    ovr: run.teamRating,
    categories,
    leverage: leverage(categories),
    losses,
    best: deltas.reduce((a, b) => (b.delta > a.delta ? b : a)),
    weakest: deltas.reduce((a, b) => (b.delta < a.delta ? b : a)),
    title: odds.title,
    invicto: odds.invicto,
  };
}
