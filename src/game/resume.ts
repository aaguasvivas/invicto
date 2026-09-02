// Resume an interrupted run. Phones reload background tabs constantly; without
// this, a reload mid-draft silently threw the whole run away. The snapshot
// stores the exact current roll and draft state (player ids, not objects), so
// restoring changes nothing about the seeded stream: the next pick rolls
// exactly what it would have rolled.

import type { Roll, Slot } from '../engine/types';
import type { GameData } from './data';
import type { Session } from './session';
import type { Mode } from './state';

export interface RunSnapshot {
  v: 1;
  mode: Mode;
  seed: string;
  scored: boolean;
  /** local day the run was dealt; a daily is only resumable on that day */
  day: string;
  lineup: Partial<Record<Slot, string>>;
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
  for (const [slot, id] of Object.entries(snap.lineup)) {
    const player = byId.get(id);
    if (!player) return null;
    lineup[slot as Slot] = player;
  }
  return {
    mode: snap.mode,
    seed: snap.seed,
    scored: snap.scored,
    day: snap.day,
    data,
    state: {
      lineup,
      draftedPersons: [...snap.draftedPersons],
      round: snap.round,
      countryRerollUsed: snap.countryRerollUsed,
      editionRerollUsed: snap.editionRerollUsed,
    },
    roll: { ...snap.roll },
    redrawAttempt: snap.redrawAttempt,
    autoRedrew: false,
  };
}

/** A daily run only makes sense on the day it was dealt; other modes keep. */
export function snapshotUsable(snap: RunSnapshot, today: string): boolean {
  return snap.mode !== 'daily' || snap.day === today;
}

// --- storage (best-effort, like the rest of the game's persistence) ---------

export function saveRun(snap: RunSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    // storage is best-effort
  }
}

export function loadRun(): RunSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RunSnapshot) : null;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
}
