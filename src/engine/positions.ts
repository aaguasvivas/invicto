// Slot eligibility. Hitters: corner outfield interchangeable (a true CF covers a
// corner), CF requires a true CF, DH accepts any hitter, infield is exact.
// Pitchers: SP and CL require the specific role, RP accepts any pitcher.
// Pure pitchers can't DH; hitters can't take the mound.

import type { Slot } from './types';

export const HITTER_SLOTS: readonly Slot[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const PITCHER_SLOTS: readonly Slot[] = ['SP', 'RP', 'CL'];
export const SLOTS: readonly Slot[] = [...HITTER_SLOTS, ...PITCHER_SLOTS];

const PITCHER_POS = new Set<Slot>(['SP', 'RP', 'CL']);

export function isPitcher(positions: Slot[]): boolean {
  return positions.some((p) => PITCHER_POS.has(p));
}

export function isEligible(positions: Slot[], slot: Slot): boolean {
  if (slot === 'RP') return isPitcher(positions);
  if (slot === 'SP' || slot === 'CL') return positions.includes(slot);
  if (slot === 'DH') return positions.some((p) => !PITCHER_POS.has(p));
  if (slot === 'LF' || slot === 'RF') {
    return positions.includes('LF') || positions.includes('RF') || positions.includes('CF');
  }
  return positions.includes(slot);
}

export function eligibleSlots(positions: Slot[], openSlots: Slot[]): Slot[] {
  return openSlots.filter((slot) => isEligible(positions, slot));
}
