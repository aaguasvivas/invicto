// Resume an interrupted run. Phones reload background tabs constantly; without
// this, a reload mid-draft silently threw the whole run away. The snapshot
// stores the exact current roll and draft state (player ids, not objects), so
// restoring changes nothing about the seeded stream: the next pick rolls
// exactly what it would have rolled.

import type { EnginePlayer, Roll, Slot } from '../engine/types';
import type { GameData } from './data';
import type { Session } from './session';
import { previousDayKey, type Mode } from './state';
import * as storage from './storage';

export interface RunSnapshot {
  v: 1;
  mode: Mode;
  seed: string;
  scored: boolean;
  /** local day the run was dealt; a daily stays resumable through that day and just past midnight */
  day: string;
  lineup: Partial<Record<Slot, string>>;
  /** written for the v1 shape; restore rebuilds it from the lineup players */
  draftedPersons: string[];
  round: number;
  countryRerollUsed: boolean;
  editionRerollUsed: boolean;
  roll: Roll;
  redrawAttempt: number;
  savedAt: number;
}

const KEY = 'invicto.run';

export function snapshotSession(session: Session): RunSnapshot {
  const lineup: Partial<Record<Slot, string>> = {};
  for (const [slot, player] of Object.entries(session.state.lineup)) {
    if (player) lineup[slot as Slot] = player.id;
  }
  return {
    v: 1,
    mode: session.mode,
    seed: session.seed,
    scored: session.scored,
    day: session.day,
    lineup,
    draftedPersons: [...session.state.draftedPersons],
    round: session.state.round,
    countryRerollUsed: session.state.countryRerollUsed,
    editionRerollUsed: session.state.editionRerollUsed,
    roll: { ...session.roll },
    redrawAttempt: session.redrawAttempt,
    savedAt: Date.now(),
  };
}

/** Rebuild a session from a snapshot; null if anything cannot be restored faithfully. */
export function restoreSession(snap: RunSnapshot, data: GameData): Session | null {
  if (!snap || snap.v !== 1 || typeof snap.seed !== 'string' || !snap.roll || !snap.lineup) return null;
  const byId = new Map(data.players.map((p) => [p.id, p]));
  const lineup: Session['state']['lineup'] = {};
  const drafted: EnginePlayer[] = [];
  for (const [slot, id] of Object.entries(snap.lineup)) {
    const player = byId.get(id);
    if (!player) return null;
    lineup[slot as Slot] = player;
    drafted.push(player);
  }
  return {
    mode: snap.mode,
    seed: snap.seed,
    scored: snap.scored,
    day: snap.day,
    data,
    state: {
      lineup,
      // From the players' current keys, never the stored list: a data deploy
      // that merges two records into one person changes personKeys, and a stale
      // list would let the merged duplicate be drafted.
      draftedPersons: drafted.map((p) => p.personKey),
      round: snap.round,
      countryRerollUsed: snap.countryRerollUsed,
      editionRerollUsed: snap.editionRerollUsed,
    },
    roll: { ...snap.roll },
    redrawAttempt: snap.redrawAttempt,
    autoRedrew: false,
  };
}

/** How long after its last save a daily dealt yesterday can still be resumed. */
const MIDNIGHT_GRACE_MS = 6 * 3600 * 1000;

/**
 * A daily belongs to the day it was dealt: it resumes all that day, and a run
 * still going at midnight resumes for a few hours after its last save, well
 * inside the 36 hours the stats server accepts. Free and hard runs always keep.
 */
export function snapshotUsable(snap: RunSnapshot, today: string, now = Date.now()): boolean {
  if (snap.mode !== 'daily' || snap.day === today) return true;
  return snap.day === previousDayKey(today) && now - snap.savedAt < MIDNIGHT_GRACE_MS;
}

// --- storage (best-effort, like the rest of the game's persistence) ---------

export function saveRun(snap: RunSnapshot): void {
  storage.set(KEY, JSON.stringify(snap));
}

export function loadRun(): RunSnapshot | null {
  const raw = storage.get(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RunSnapshot;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  storage.remove(KEY);
}
