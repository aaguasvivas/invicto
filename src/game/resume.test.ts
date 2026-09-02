// Resuming an interrupted run (a mobile tab reload mid-draft is common). The
// snapshot must restore the EXACT roll and state so the seeded stream is not
// disturbed, reject anything it cannot faithfully rebuild, and never revive a
// stale daily.

import { describe, expect, test } from 'vitest';
import { makePlayer } from '../engine/test-helpers';
import type { GameData } from './data';
import { restoreSession, snapshotSession, snapshotUsable, type RunSnapshot } from './resume';
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

describe('snapshotUsable', () => {
  test('a daily run is only usable on the day it started', () => {
    const snap = snapshotSession(midDraft());
    expect(snapshotUsable(snap, '2026-06-12')).toBe(true);
    expect(snapshotUsable(snap, '2026-06-13')).toBe(false);
  });

  test('free and hard runs stay usable across days', () => {
    const snap = snapshotSession({ ...midDraft(), mode: 'free', seed: 'free-abc', scored: true });
    expect(snapshotUsable(snap, '2026-07-01')).toBe(true);
  });
});
