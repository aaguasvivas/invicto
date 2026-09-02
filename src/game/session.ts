// One run of the game: mode + seed + draft state + the current roll.
// All randomness flows through the engine's seeded streams.

import {
  applyPick, canEditionReroll, hasLegalPick, markCountryReroll, markEditionReroll,
  newDraft, openSlots, rollBase, rollCountryReroll, rollEditionReroll, rollRedraw,
  type DraftState,
} from '../engine/draft';
import type { EnginePlayer, LineupSlots, Roll, Slot } from '../engine/types';
import { todayKey, type Mode } from './state';
import { roster, type GameData } from './data';

export interface Session {
  mode: Mode;
  seed: string;
  scored: boolean;
  /** local day the run was dealt: results and streaks are keyed to it, not to
      whenever the result screen renders (a run can cross midnight) */
  day: string;
  data: GameData;
  state: DraftState;
  roll: Roll;
  redrawAttempt: number;
  /** set when the roll just auto-redrew because nothing was pickable */
  autoRedrew: boolean;
}

export function newSession(data: GameData, mode: Mode, scored: boolean): Session {
  const day = todayKey();
  const seed =
    mode === 'daily'
      ? `daily-${day}`
      : `${mode}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const session: Session = {
    mode,
    seed,
    scored,
    day,
    data,
    state: newDraft(),
    roll: rollBase(seed, 0, data.editionTeams),
    redrawAttempt: 0,
    autoRedrew: false,
  };
  ensureLegal(session);
  return session;
}

export function currentRoster(session: Session): EnginePlayer[] {
  return roster(session.data, session.roll.edition, session.roll.country);
}

/** Redraw (deterministically) until the roll offers at least one legal pick. */
function ensureLegal(session: Session): void {
  session.autoRedrew = false;
  while (!hasLegalPick(session.state, currentRoster(session))) {
    session.redrawAttempt += 1;
    session.roll = rollRedraw(session.seed, session.state.round, session.redrawAttempt, session.data.editionTeams);
    session.autoRedrew = true;
  }
}

export function pick(session: Session, player: EnginePlayer, slot: Slot): void {
  session.state = applyPick(session.state, player, slot);
  if (openSlots(session.state).length > 0) {
    session.redrawAttempt = 0;
    session.roll = rollBase(session.seed, session.state.round, session.data.editionTeams);
    ensureLegal(session);
  }
}

export function draftDone(session: Session): boolean {
  return openSlots(session.state).length === 0;
}

export function lineup(session: Session): LineupSlots {
  return session.state.lineup;
}

export function canRerollCountry(session: Session): boolean {
  return !session.state.countryRerollUsed;
}

export function canRerollEdition(session: Session): boolean {
  return !session.state.editionRerollUsed && canEditionReroll(session.roll, session.data.editionTeams);
}

export function rerollCountry(session: Session): void {
  session.state = markCountryReroll(session.state);
  session.roll = rollCountryReroll(session.seed, session.state.round, session.roll, session.data.editionTeams);
  session.redrawAttempt = 0;
  ensureLegal(session);
}

export function rerollEdition(session: Session): void {
  session.state = markEditionReroll(session.state);
  session.roll = rollEditionReroll(session.seed, session.state.round, session.roll, session.data.editionTeams);
  session.redrawAttempt = 0;
  ensureLegal(session);
}
