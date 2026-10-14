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
// - The scout's lineup: the strongest lineup a fixed search builds from the
//   run's 12 base rolls, with no rerolls, and the draft grade against it.

import { rollBase } from '../engine/draft';
import { HITTER_SLOTS, isEligible, SLOTS } from '../engine/positions';
import { scheduleOpponents, simulateRun, winChance } from '../engine/simulate';
import { CATEGORIES, categoryRatings, RATING_WEIGHTS, ratingFromCategories, teamRating, type Category } from '../engine/teamRating';
import type { EditionTeams, EnginePlayer, LineupSlots, RunResult, Slot, Stage } from '../engine/types';
import { roster, type GameData } from './data';

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

// ---------------------------------------------------------------------------
// The scout's lineup and the draft grade
//
// The scout drafts the run's 12 base rolls, one pick per round, and never
// rerolls: rerolls are the player's edge over it. The goal is the highest
// Team OVR with every slot filled by a player who can play it and no person
// twice. The search is a fixed local search, strong but not proven optimal:
// - Start: match each round to a slot it can fill (augmenting paths, so a
//   full matching is found whenever one exists), then give each round its
//   strongest player for that slot.
// - Passes: give a round a better player for its slot; or let two rounds
//   trade slots, each picking again for its new slot. A pass that improves
//   nothing ends the start, and so does the 30th.
// - Three fixed starts (the matching tried in three fixed orders), ties to
//   the lower player id. It reads only the rollBase streams, draws nothing
//   new and reads no clock, so a seed always gets the same scout.
//
// A full lineup's Team OVR depends only on who holds the nine hitter slots
// and who holds the three on the mound: the five hitter means and the mean
// pitcher rating. The search ranks lineups by the soft-min sum those six
// values make (Team OVR falls as the sum grows). With p = -4 the sum takes
// only products and one division, which every JS engine rounds the same
// way, unlike Math.pow, so the search takes the same path in every browser.
// (Checked when this was written: V8 and JavaScriptCore built the same scout,
// with the same record, on all 365 dailies from launch day. The scout's Team
// OVR goes through Math.pow and differed in its last bit on 13 of them, far
// below the tenth the card shows.)

export const MAX_PASSES = 30;
export const SCOUT_STARTS = 3;

/** A move must improve the sum by more than this share of it: float noise never counts as progress. */
const EPSILON = 1e-12;

/** The six values in CATEGORIES order: hitter means over the nine hitters, pitching over the three pitchers. */
const DIVISORS = CATEGORIES.map((c) => (c === 'pitching' ? SLOTS.length - HITTER_SLOTS.length : HITTER_SLOTS.length));
const WEIGHTS = CATEGORIES.map((c) => RATING_WEIGHTS[c]);

/** One category's term of the sum, w·max(1, v)^-4, in products and one division. */
function term(c: number, value: number): number {
  const v = Math.max(1, value);
  const square = v * v;
  return WEIGHTS[c] / (square * square);
}

/** Σ w·max(1, v)^-4 over the six category values (CATEGORIES order); softMin is this sum to the power -1/4. */
export function softMinSum(values: readonly number[]): number {
  let sum = 0;
  for (let c = 0; c < values.length; c++) sum += term(c, values[c]);
  return sum;
}

/** What a player adds to the six category totals from a slot: his hitting from a hitter slot, his rating from the mound. */
function contributionVector(player: EnginePlayer, slot: number): number[] {
  return slot < HITTER_SLOTS.length
    ? [player.contact, player.power, player.speed, player.defense, player.clutch, 0]
    : [0, 0, 0, 0, 0, player.rating];
}

/** A player who can fill a slot, with what he adds there. */
interface Candidate {
  player: EnginePlayer;
  vector: number[];
}

/** One start of the search: round r holds slot slots[r] with picks[r]. */
interface Search {
  slots: number[];
  picks: Candidate[];
  /** the six category totals of the lineup */
  totals: number[];
  /** softMinSum of the means: lower is a higher Team OVR */
  sum: number;
}

const byId = (a: EnginePlayer, b: EnginePlayer) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The sum after taking some contributions out of the totals and putting others in (none: the totals as they are). */
function sumAfter(totals: readonly number[], out: number[][] = [], into: number[][] = []): number {
  // Called for every candidate move, so it builds no arrays of its own.
  let sum = 0;
  for (let c = 0; c < totals.length; c++) {
    let total = totals[c];
    for (const v of out) total -= v[c];
    for (const v of into) total += v[c];
    sum += term(c, total / DIVISORS[c]);
  }
  return sum;
}

/** Totals and sum recomputed from the picks, so no rounding builds up over the moves. */
function settle(search: Search): void {
  search.totals = [0, 0, 0, 0, 0, 0];
  for (const pick of search.picks) for (let c = 0; c < 6; c++) search.totals[c] += pick.vector[c];
  search.sum = sumAfter(search.totals);
}

/** How a start ranks a player for a slot before the search: his hitting total, or his rating on the mound. */
const startValue = (c: Candidate) => c.vector.reduce((a, b) => a + b, 0);

/**
 * A round-to-slot matching (augmenting paths), the rounds taken in `rounds`
 * order, each trying its slots in the order `slotOrder` gives. Null when the
 * rolls cannot fill all 12 slots.
 */
function matchSlots(eligible: Candidate[][][], rounds: number[], slotOrder: (round: number) => number[]): number[] | null {
  const roundAt = new Array<number>(SLOTS.length).fill(-1);
  const place = (round: number, seen: boolean[]): boolean => {
    for (const slot of slotOrder(round)) {
      if (seen[slot] || eligible[round][slot].length === 0) continue;
      seen[slot] = true;
      if (roundAt[slot] < 0 || place(roundAt[slot], seen)) {
        roundAt[slot] = round;
        return true;
      }
    }
    return false;
  };
  for (const round of rounds) if (!place(round, new Array<boolean>(SLOTS.length).fill(false))) return null;
  const slots = new Array<number>(SLOTS.length);
  roundAt.forEach((round, slot) => (slots[round] = slot));
  return slots;
}

/** The three fixed starts: rounds in order with the slots in order, with each round's strongest slots first, and both reversed. */
function startMatchings(eligible: Candidate[][][]): (number[] | null)[] {
  const forward = SLOTS.map((_, i) => i);
  const backward = [...forward].reverse();
  const best = (round: number, slot: number) => Math.max(0, ...eligible[round][slot].map(startValue));
  return [
    matchSlots(eligible, forward, () => forward),
    matchSlots(eligible, forward, (round) => [...forward].sort((a, b) => best(round, b) - best(round, a) || a - b)),
    matchSlots(eligible, backward, () => backward),
  ];
}

/** Each round takes its strongest player for its slot whose person is still free; null when one has nobody left. */
function fill(eligible: Candidate[][][], slots: number[]): Search | null {
  const taken = new Set<string>();
  const picks: Candidate[] = [];
  for (let round = 0; round < slots.length; round++) {
    let choice: Candidate | null = null;
    for (const c of eligible[round][slots[round]]) {
      if (!taken.has(c.player.personKey) && (!choice || startValue(c) > startValue(choice))) choice = c;
    }
    if (!choice) return null;
    taken.add(choice.player.personKey);
    picks.push(choice);
  }
  const search: Search = { slots, picks, totals: [], sum: 0 };
  settle(search);
  return search;
}

/** Whether a player's person is on the lineup in a round other than the ones being changed. */
function personTaken(search: Search, player: EnginePlayer, ...changing: number[]): boolean {
  return search.picks.some((pick, round) => !changing.includes(round) && pick.player.personKey === player.personKey);
}

/** One pass of both moves over every round and every pair of rounds. Returns whether anything improved. */
function improve(search: Search, eligible: Candidate[][][]): boolean {
  let improved = false;
  const rounds = search.slots.length;

  // A better player for the same slot, from the same roll.
  for (let r = 0; r < rounds; r++) {
    const old = search.picks[r];
    let choice: Candidate | null = null;
    let best = search.sum;
    for (const c of eligible[r][search.slots[r]]) {
      if (c === old || personTaken(search, c.player, r)) continue;
      const sum = sumAfter(search.totals, [old.vector], [c.vector]);
      if (sum < best * (1 - EPSILON)) {
        best = sum;
        choice = c;
      }
    }
    if (choice) {
      search.picks[r] = choice;
      settle(search);
      improved = true;
    }
  }

  // Two rounds trade slots, and each picks again for its new slot.
  for (let a = 0; a < rounds - 1; a++) {
    for (let b = a + 1; b < rounds; b++) {
      const [slotA, slotB] = [search.slots[a], search.slots[b]];
      const out = [search.picks[a].vector, search.picks[b].vector];
      let choice: [Candidate, Candidate] | null = null;
      let best = search.sum;
      for (const ca of eligible[a][slotB]) {
        if (personTaken(search, ca.player, a, b)) continue;
        for (const cb of eligible[b][slotA]) {
          if (cb.player.personKey === ca.player.personKey || personTaken(search, cb.player, a, b)) continue;
          const sum = sumAfter(search.totals, out, [ca.vector, cb.vector]);
          if (sum < best * (1 - EPSILON)) {
            best = sum;
            choice = [ca, cb];
          }
        }
      }
      if (choice) {
        search.slots[a] = slotB;
        search.slots[b] = slotA;
        [search.picks[a], search.picks[b]] = choice;
        settle(search);
        improved = true;
      }
    }
  }
  return improved;
}

export interface ScoutLineup {
  lineup: LineupSlots;
  /** the slot each round's pick holds, round by round */
  slots: Slot[];
  /** teamRating of the lineup */
  ovr: number;
  /** simulateRun of the lineup on the run's seed: the scout's record */
  run: RunResult;
  /** search passes over all starts, one per step of scoutSearch */
  passes: number;
}

/**
 * The scout's search as steps: it yields after every pass, so a screen can
 * run one pass per task and stop when the player leaves. Returns null when
 * the 12 base rolls cannot fill a lineup.
 */
export function* scoutSearch(seed: string, data: GameData): Generator<void, ScoutLineup | null, void> {
  const eligible = SLOTS.map((_, round) => {
    const roll = rollBase(seed, round, data.editionTeams);
    const players = [...roster(data, roll.edition, roll.country)].sort(byId);
    return SLOTS.map((slot, i) => players.filter((p) => isEligible(p.positions, slot)).map((player) => ({ player, vector: contributionVector(player, i) })));
  });

  let best: Search | null = null;
  let passes = 0;
  for (const slots of startMatchings(eligible)) {
    const search = slots && fill(eligible, slots);
    if (!search) continue;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const improved = improve(search, eligible);
      passes++;
      yield;
      if (!improved) break;
    }
    if (!best || search.sum < best.sum * (1 - EPSILON)) best = search;
  }
  if (!best) return null;

  const lineup: LineupSlots = {};
  best.slots.forEach((slot, round) => (lineup[SLOTS[slot]] = best.picks[round].player));
  return { lineup, slots: best.slots.map((slot) => SLOTS[slot]), ovr: teamRating(lineup), run: simulateRun(lineup, seed), passes };
}

/** The whole search at once (tests, and anything that does not need to yield). */
export function scoutLineup(seed: string, data: GameData): ScoutLineup | null {
  const search = scoutSearch(seed, data);
  let step = search.next();
  while (!step.done) step = search.next();
  return step.value;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/**
 * The draft grade for a gap (the scout's Team OVR minus yours, in points),
 * judged on whole tenths so float noise never moves a boundary: S at 0 or
 * better, A up to 1.5, B up to 3, C up to 5, D beyond.
 */
export function draftGrade(gap: number): Grade {
  const tenths = Math.round(gap * 10);
  return tenths <= 0 ? 'S' : tenths <= 15 ? 'A' : tenths <= 30 ? 'B' : tenths <= 50 ? 'C' : 'D';
}

/** A Team OVR to the tenth the card shows. */
const tenth = (n: number): number => Math.round(n * 10) / 10;

/** The graded draft as the daily record keeps it: both Team OVRs to the tenth, the grade, and the scout's record. */
export interface DraftGrade {
  ovr: number;
  grade: Grade;
  par: { ovr: number; wins: number; losses: number };
}

export function gradeDraft(yourOvr: number, scout: ScoutLineup): DraftGrade {
  const ovr = tenth(yourOvr);
  const par = tenth(scout.ovr);
  return { ovr, grade: draftGrade(par - ovr), par: { ovr: par, wins: scout.run.wins, losses: scout.run.losses } };
}

/**
 * The slots whose pick came from a roll the scout never saw: the rounds where
 * the player rerolled or was redrawn. Matched by team, so it needs no pick
 * order (a rebuilt lineup has none): each base roll covers one pick from its
 * team, the earlier slot first, and a pick no base roll covers is marked.
 */
export function rerolledSlots(seed: string, lineup: LineupSlots, teams: EditionTeams): Slot[] {
  const dealt = new Map<string, number>();
  for (let round = 0; round < SLOTS.length; round++) {
    const roll = rollBase(seed, round, teams);
    const team = `${roll.edition}-${roll.country}`;
    dealt.set(team, (dealt.get(team) ?? 0) + 1);
  }
  return SLOTS.filter((slot) => {
    const p = lineup[slot];
    if (!p) return false;
    const team = `${p.edition}-${p.country}`;
    const left = dealt.get(team) ?? 0;
    if (left === 0) return true;
    dealt.set(team, left - 1);
    return false;
  });
}
