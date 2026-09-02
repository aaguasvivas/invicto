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

  test('there are twelve slots: nine hitters plus SP, RP, CL', () => {
    expect(SLOTS).toHaveLength(12);
    expect(SLOTS).toContain('SP');
    expect(SLOTS).toContain('RP');
    expect(SLOTS).toContain('CL');
  });

  test('SP and CL require the specific role', () => {
    expect(isEligible(['SP', 'RP'], 'SP')).toBe(true);
    expect(isEligible(['RP'], 'SP')).toBe(false);
    expect(isEligible(['RP', 'CL'], 'CL')).toBe(true);
    expect(isEligible(['SP', 'RP'], 'CL')).toBe(false);
  });

  test('RP accepts any pitcher, the DH of the mound', () => {
    expect(isEligible(['SP', 'RP'], 'RP')).toBe(true);
    expect(isEligible(['RP', 'CL'], 'RP')).toBe(true);
    expect(isEligible(['SP'], 'RP')).toBe(true);
  });

  test('hitters cannot fill pitcher slots and pure pitchers cannot DH', () => {
    expect(isEligible(['SS', '2B'], 'RP')).toBe(false);
    expect(isEligible(['C'], 'SP')).toBe(false);
    expect(isEligible(['SP', 'RP'], 'DH')).toBe(false);
    expect(isEligible(['RP', 'CL'], 'LF')).toBe(false);
  });

  test('a two-way star can fill DH and his pitching roles', () => {
    expect(isEligible(['DH', 'SP', 'RP'], 'DH')).toBe(true);
    expect(isEligible(['DH', 'SP', 'RP'], 'SP')).toBe(true);
    expect(isEligible(['DH', 'SP', 'RP'], 'RP')).toBe(true);
    expect(isEligible(['DH', 'SP', 'RP'], 'CL')).toBe(false);
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
