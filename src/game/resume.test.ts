// Resuming an interrupted run (a mobile tab reload mid-draft is common). The
// snapshot must restore the EXACT roll and state so the seeded stream is not
// disturbed, reject anything it cannot faithfully rebuild, and never revive a
// stale daily.

import { describe, expect, test } from 'vitest';
import { applyPick, openSlots } from '../engine/draft';
import { lineupWithMeans, makePlayer } from '../engine/test-helpers';
import type { EnginePlayer } from '../engine/types';
import type { GameData } from './data';
import { lineupComplete, restoreSession, snapshotSession, snapshotUsable, type RunSnapshot } from './resume';
import type { Session } from './session';

const p1 = makePlayer({ id: '2023-ven-perez', positions: ['C'], country: 'VEN', edition: 2023 });
const p2 = makePlayer({ id: '2006-ven-santana', positions: ['SP', 'RP'], country: 'VEN', edition: 2006 });

const data: GameData = {
  players: [p1, p2],
  byTeam: new Map(),
  editionTeams: { 2006: ['VEN'], 2023: ['VEN'] },
  countries: new Map(),
};

function midDraft(): Session {
  return {
    mode: 'daily',
    seed: 'daily-2026-06-12',
    scored: true,
    day: '2026-06-12',
    data,
    state: {
      lineup: { C: p1, SP: p2 },
      draftedPersons: [p1.personKey, p2.personKey],
      round: 2,
      countryRerollUsed: true,
      editionRerollUsed: false,
    },
    roll: { country: 'VEN', edition: 2006 },
    redrawAttempt: 1,
    autoRedrew: false,
  };
}

describe('snapshotSession / restoreSession', () => {
  test('round-trips a mid-draft session exactly', () => {
    const restored = restoreSession(snapshotSession(midDraft()), data);
    expect(restored).not.toBeNull();
    expect(restored!.seed).toBe('daily-2026-06-12');
    expect(restored!.mode).toBe('daily');
    expect(restored!.day).toBe('2026-06-12');
    expect(restored!.scored).toBe(true);
    expect(restored!.state.lineup.C?.id).toBe(p1.id);
    expect(restored!.state.lineup.SP?.id).toBe(p2.id);
    expect(restored!.state.draftedPersons).toEqual([p1.personKey, p2.personKey]);
    expect(restored!.state.round).toBe(2);
    expect(restored!.state.countryRerollUsed).toBe(true);
    expect(restored!.state.editionRerollUsed).toBe(false);
    expect(restored!.roll).toEqual({ country: 'VEN', edition: 2006 });
    expect(restored!.redrawAttempt).toBe(1);
  });

  test('snapshot stores player ids, not player objects', () => {
    const snap = snapshotSession(midDraft());
    expect(snap.lineup).toEqual({ C: p1.id, SP: p2.id });
  });

  test('refuses a snapshot whose player is not in the dataset', () => {
    const snap = snapshotSession(midDraft());
    snap.lineup.C = 'someone-who-was-removed';
    expect(restoreSession(snap, data)).toBeNull();
  });

  test('refuses malformed input', () => {
    expect(restoreSession({ v: 99 } as unknown as RunSnapshot, data)).toBeNull();
    expect(restoreSession(null as unknown as RunSnapshot, data)).toBeNull();
  });
});

describe('snapshotSession / restoreSession: a complete lineup', () => {
  // The draft autosaves the 12th pick too, so a reload during the sim reveal
  // resumes into the same (deterministic) tournament instead of the draft.
  test('a 12-pick snapshot round-trips with no open slots and keeps scored', () => {
    const lineup = lineupWithMeans(72, 70, 56, 58, 72, 70);
    const players = Object.values(lineup) as EnginePlayer[];
    const full: Session = {
      ...midDraft(),
      data: { ...data, players },
      state: { lineup, draftedPersons: players.map((p) => p.personKey), round: 12, countryRerollUsed: true, editionRerollUsed: true },
    };
    const restored = restoreSession(snapshotSession(full), full.data)!;
    expect(openSlots(restored.state)).toEqual([]);
    expect(restored.scored).toBe(true);
    expect(restored.state.round).toBe(12);
    expect(Object.keys(restored.state.lineup)).toHaveLength(12);
  });
});

describe('restoreSession: drafted persons', () => {
  // A data deploy can merge two records into one person (new personKey). The
  // stored key list would then miss the merged duplicate, so it is rebuilt from
  // the restored players' current keys and never trusted.
  test('stale draftedPersons are rebuilt from the lineup players', () => {
    const snap = snapshotSession(midDraft());
    snap.draftedPersons = ['perez|?', 'santana|?'];
    const restored = restoreSession(snap, data)!;
    expect([...restored.state.draftedPersons].sort()).toEqual([p1.personKey, p2.personKey].sort());
  });

  test('a merged duplicate of a drafted player is then refused', () => {
    const snap = snapshotSession(midDraft());
    snap.draftedPersons = ['perez|?', 'santana|?'];
    const restored = restoreSession(snap, data)!;
    const sameManOtherEdition = makePlayer({ id: '2017-ven-perez', personKey: p1.personKey, positions: ['1B'] });
    expect(() => applyPick(restored.state, sameManOtherEdition, '1B')).toThrow(/already on your team/);
  });
});

describe('snapshotUsable', () => {
  const HOUR = 3600 * 1000;

  test('a daily run is usable all through the day it was dealt', () => {
    const snap = snapshotSession(midDraft());
    expect(snapshotUsable(snap, '2026-06-12', snap.savedAt + 20 * HOUR)).toBe(true);
  });

  test('a daily from yesterday is usable for a few hours after its last save', () => {
    // started at 23:55, the phone reloaded the tab at 00:03
    const snap = snapshotSession(midDraft());
    expect(snapshotUsable(snap, '2026-06-13', snap.savedAt + 8 * 60 * 1000)).toBe(true);
    expect(snapshotUsable(snap, '2026-06-13', snap.savedAt + 5.9 * HOUR)).toBe(true);
  });

  test('a daily from yesterday left overnight is not usable', () => {
    const snap = snapshotSession(midDraft());
    expect(snapshotUsable(snap, '2026-06-13', snap.savedAt + 6 * HOUR)).toBe(false);
  });

  test('a daily from two days ago is not usable', () => {
    const snap = snapshotSession(midDraft());
    expect(snapshotUsable(snap, '2026-06-14', snap.savedAt + 60 * 1000)).toBe(false);
  });

  test('free and hard runs stay usable across days', () => {
    const free = snapshotSession({ ...midDraft(), mode: 'free', seed: 'free-abc', scored: true });
    const hard = snapshotSession({ ...midDraft(), mode: 'hard', seed: 'hard-abc', scored: true });
    expect(snapshotUsable(free, '2026-07-01', free.savedAt + 400 * HOUR)).toBe(true);
    expect(snapshotUsable(hard, '2026-07-01', hard.savedAt + 400 * HOUR)).toBe(true);
  });
});

describe('lineupComplete', () => {
  test('is true once all 12 slots are filled: that run was committed and only its reveal is left', () => {
    expect(lineupComplete(snapshotSession(midDraft()))).toBe(false);
    const full = midDraft();
    full.state = { ...full.state, lineup: lineupWithMeans(70, 70, 70, 70, 70, 70), round: 12 };
    expect(lineupComplete(snapshotSession(full))).toBe(true);
  });
});
