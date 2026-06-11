// Draft rolls and state transitions. All functions are pure; rolls are addressed
// by (seed, round, kind) so they never depend on when the player acts.

import { rngFor } from './rng';
import { SLOTS, isEligible } from './positions';
import type { EditionTeams, EnginePlayer, Roll, Slot } from './types';

/** Baseball powers appear in ~70% of rolls; everyone else shares the other ~30%. */
export const POWERS = ['DOM', 'VEN', 'PUR', 'USA', 'JPN', 'MEX', 'CUB', 'KOR', 'TPE', 'NED'];
export const POWER_ROLL_SHARE = 0.7;

function countriesOf(teams: EditionTeams): { powers: string[]; minnows: string[] } {
  const all = new Set<string>();
  for (const codes of Object.values(teams)) for (const c of codes) all.add(c);
  const powers = [...all].filter((c) => POWERS.includes(c)).sort();
  const minnows = [...all].filter((c) => !POWERS.includes(c)).sort();
  return { powers, minnows };
}

function editionsOf(country: string, teams: EditionTeams): number[] {
  return Object.keys(teams)
    .map(Number)
    .filter((year) => teams[year].includes(country))
    .sort();
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function rollWith(rng: () => number, teams: EditionTeams): Roll {
  const { powers, minnows } = countriesOf(teams);
  const usePower = rng() < POWER_ROLL_SHARE && powers.length > 0;
  const country = pick(usePower ? powers : minnows.length > 0 ? minnows : powers, rng);
  const edition = pick(editionsOf(country, teams), rng);
  return { country, edition };
}

export function rollBase(seed: string, round: number, teams: EditionTeams): Roll {
  return rollWith(rngFor(seed, 'roll', round), teams);
}

/** Free re-draw when a roll has no legal pick (attempt = 1, 2, …). */
export function rollRedraw(seed: string, round: number, attempt: number, teams: EditionTeams): Roll {
  return rollWith(rngFor(seed, 'redraw', round, attempt), teams);
}

/** New country, same edition. */
export function rollCountryReroll(seed: string, round: number, current: Roll, teams: EditionTeams): Roll {
  const rng = rngFor(seed, 'country-reroll', round);
  const others = teams[current.edition].filter((c) => c !== current.country);
  return { country: pick(others, rng), edition: current.edition };
}

/** Same country, new edition. Check canEditionReroll first. */
export function rollEditionReroll(seed: string, round: number, current: Roll, teams: EditionTeams): Roll {
  const rng = rngFor(seed, 'edition-reroll', round);
  const others = editionsOf(current.country, teams).filter((y) => y !== current.edition);
  if (others.length === 0) throw new Error(`${current.country} played only one edition`);
  return { country: current.country, edition: pick(others, rng) };
}

export function canEditionReroll(current: Roll, teams: EditionTeams): boolean {
  return editionsOf(current.country, teams).length > 1;
}

// ---------------------------------------------------------------------------
// Draft state

export interface DraftState {
  lineup: Partial<Record<Slot, EnginePlayer>>;
  draftedPersons: string[];
  round: number;
  countryRerollUsed: boolean;
  editionRerollUsed: boolean;
}

export function newDraft(): DraftState {
  return { lineup: {}, draftedPersons: [], round: 0, countryRerollUsed: false, editionRerollUsed: false };
}

export function openSlots(state: DraftState): Slot[] {
  return SLOTS.filter((s) => !state.lineup[s]);
}

export function isComplete(state: DraftState): boolean {
  return openSlots(state).length === 0;
}

export function applyPick(state: DraftState, player: EnginePlayer, slot: Slot): DraftState {
  if (state.lineup[slot]) throw new Error(`${slot} is already filled`);
  if (!isEligible(player.positions, slot)) throw new Error(`${player.name} cannot play ${slot}`);
  if (state.draftedPersons.includes(player.personKey)) throw new Error(`${player.name} is already on your team`);
  return {
    ...state,
    lineup: { ...state.lineup, [slot]: player },
    draftedPersons: [...state.draftedPersons, player.personKey],
    round: state.round + 1,
  };
}

export function markCountryReroll(state: DraftState): DraftState {
  if (state.countryRerollUsed) throw new Error('country reroll already used');
  return { ...state, countryRerollUsed: true };
}

export function markEditionReroll(state: DraftState): DraftState {
  if (state.editionRerollUsed) throw new Error('edition reroll already used');
  return { ...state, editionRerollUsed: true };
}

/** Does this roster offer at least one legal pick for the current state? */
export function hasLegalPick(state: DraftState, roster: EnginePlayer[]): boolean {
  const open = openSlots(state);
  return roster.some(
    (p) => !state.draftedPersons.includes(p.personKey) && open.some((slot) => isEligible(p.positions, slot)),
  );
}
