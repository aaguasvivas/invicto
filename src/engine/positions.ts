// Slot eligibility: corner outfield is interchangeable (and a true CF can cover a
// corner), CF requires a true CF, DH accepts anyone, everything else is exact.

import type { Slot } from './types';

export const SLOTS: readonly Slot[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

export function isEligible(positions: Slot[], slot: Slot): boolean {
  if (slot === 'DH') return true;
  if (slot === 'LF' || slot === 'RF') {
    return positions.includes('LF') || positions.includes('RF') || positions.includes('CF');
  }
  return positions.includes(slot);
}

export function eligibleSlots(positions: Slot[], openSlots: Slot[]): Slot[] {
  return openSlots.filter((slot) => isEligible(positions, slot));
}
