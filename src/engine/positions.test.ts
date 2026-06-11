import { describe, expect, test } from 'vitest';
import { SLOTS, isEligible, eligibleSlots } from './positions';
import type { Slot } from './types';

describe('isEligible', () => {
  test('DH accepts anyone', () => {
    expect(isEligible(['C'], 'DH')).toBe(true);
    expect(isEligible(['SS'], 'DH')).toBe(true);
    expect(isEligible(['DH'], 'DH')).toBe(true);
  });

  test('infield slots require the exact position', () => {
    expect(isEligible(['SS'], 'SS')).toBe(true);
    expect(isEligible(['SS'], '2B')).toBe(false);
    expect(isEligible(['SS', '2B'], '2B')).toBe(true);
    expect(isEligible(['1B'], '3B')).toBe(false);
  });

  test('catcher slot requires C', () => {
    expect(isEligible(['C'], 'C')).toBe(true);
    expect(isEligible(['1B', 'SS', 'LF', 'CF'], 'C')).toBe(false);
  });

  test('corner outfield is interchangeable', () => {
    expect(isEligible(['LF'], 'RF')).toBe(true);
    expect(isEligible(['RF'], 'LF')).toBe(true);
  });

  test('true CF required for CF; corner-only outfielders are not CF-eligible', () => {
    expect(isEligible(['LF', 'RF'], 'CF')).toBe(false);
    expect(isEligible(['CF'], 'CF')).toBe(true);
  });

  test('a CF can cover the corners', () => {
    expect(isEligible(['CF'], 'LF')).toBe(true);
    expect(isEligible(['CF'], 'RF')).toBe(true);
  });

  test('DH-only players fit only DH', () => {
    for (const slot of SLOTS.filter((s) => s !== 'DH')) {
      expect(isEligible(['DH'], slot)).toBe(false);
    }
    expect(isEligible(['DH'], 'DH')).toBe(true);
  });
});

describe('eligibleSlots', () => {
  test('returns only open slots the player can fill', () => {
    const open: Slot[] = ['C', 'CF', 'DH'];
    expect(eligibleSlots(['LF'], open)).toEqual(['DH']);
    expect(eligibleSlots(['CF'], open)).toEqual(['CF', 'DH']);
    expect(eligibleSlots(['C'], open)).toEqual(['C', 'DH']);
  });
});
