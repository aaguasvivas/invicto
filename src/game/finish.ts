// Committing a finished run: the scored daily, the personal best, badges and
// the run itself (for challenge comparisons). It runs as soon as the lineup is
// complete and the tournament is simulated, before the 7-10 s reveal: a reload
// during the reveal finds the day already played instead of an open daily to
// redo.

import type { RunResult } from '../engine/types';
import { badgesEarnedSince, evaluateBadges, recordBadges, type BadgeId } from './badges';
import { rememberRun } from './challenge';
import type { Session } from './session';
import { dailyResult, saveBest, saveDailyResult, type StoredResult } from './state';

function sameResult(a: StoredResult, b: StoredResult): boolean {
  return a.record === b.record && a.wins === b.wins && a.losses === b.losses && a.outcome === b.outcome;
}

/**
 * Save what the run earned; returns the badges earned for the first time.
 * replayOf: the savedAt of the snapshot a run resumed from with its lineup
 * complete. That run was committed right after the snapshot, before a reload
 * cut its reveal short, so the badges it unlocked then are the ones to show.
 */
export function recordRun(session: Session, run: RunResult, replayOf?: number): BadgeId[] {
  const result: StoredResult = { record: `${run.wins}-${run.losses}`, wins: run.wins, losses: run.losses, outcome: run.outcome };

  if (session.mode === 'daily' && session.scored) {
    const saved = dailyResult(session.day);
    // Another tab finished this daily first, so this run is practice. A replay
    // of this same run (resumed after a reload during the reveal) finds its own
    // result, identical because the sim is deterministic, and stays scored.
    if (saved && !sameResult(saved, result)) session.scored = false;
  }

  if (session.scored) {
    // Keyed to the day the run was dealt, so a run that crosses midnight still
    // counts for its own daily (and never blocks the next one).
    if (session.mode === 'daily') saveDailyResult(result, session.day);
    saveBest(session.mode, result);
  }

  // A link to this deal can then open straight on the comparison.
  rememberRun(session.seed, session.state.lineup, session.day);

  // Every finished run earns badges, practice included.
  const earned = evaluateBadges(session.state.lineup, run);
  const fresh = recordBadges(earned);
  return replayOf === undefined ? fresh : badgesEarnedSince(earned, replayOf);
}
