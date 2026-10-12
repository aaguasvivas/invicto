import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  POWERS, applyPick, canEditionReroll, hasLegalPick, isComplete, markCountryReroll, markEditionReroll,
  newDraft, openSlots, rollBase, rollCountryReroll, rollEditionReroll, rollRedraw,
} from './draft';
import { isEligible } from './positions';
import { makePlayer } from './test-helpers';
import type { EditionTeams, EnginePlayer } from './types';

// Mirrors the real editions.json shape: edition year → country codes that played it.
const TEAMS: EditionTeams = {
  2013: ['DOM', 'PUR', 'ESP', 'VEN', 'JPN', 'NED', 'ITA', 'BRA', 'CHN', 'USA', 'MEX', 'CUB', 'KOR', 'TPE', 'CAN', 'AUS'],
  2023: ['DOM', 'PUR', 'VEN', 'JPN', 'NED', 'ITA', 'CHN', 'USA', 'MEX', 'CUB', 'KOR', 'TPE', 'CAN', 'AUS', 'CZE', 'GBR', 'NCA', 'ISR', 'COL', 'PAN'],
};

describe('rollBase', () => {
  test('is deterministic for the same seed and round, regardless of call history', () => {
    const a = rollBase('daily-2026-06-11', 4, TEAMS);
    rollBase('daily-2026-06-11', 0, TEAMS); // unrelated call must not affect it
    const b = rollBase('daily-2026-06-11', 4, TEAMS);
    expect(a).toEqual(b);
  });

  test('always returns a (country, edition) pair that actually played', () => {
    for (let round = 0; round < 200; round++) {
      const roll = rollBase('validity', round, TEAMS);
      expect(TEAMS[roll.edition]).toContain(roll.country);
    }
  });

  test('powers appear in roughly 70% of rolls', () => {
    let powers = 0;
    const n = 10000;
    for (let round = 0; round < n; round++) {
      if (POWERS.includes(rollBase('weighting', round, TEAMS).country)) powers++;
    }
    expect(powers / n).toBeGreaterThan(0.65);
    expect(powers / n).toBeLessThan(0.75);
  });
});

describe('rerolls', () => {
  test('country reroll keeps the edition and changes the country, deterministically', () => {
    const base = rollBase('seed-r', 2, TEAMS);
    const a = rollCountryReroll('seed-r', 2, base, TEAMS);
    const b = rollCountryReroll('seed-r', 2, base, TEAMS);
    expect(a).toEqual(b);
    expect(a.edition).toBe(base.edition);
    expect(a.country).not.toBe(base.country);
    expect(TEAMS[a.edition]).toContain(a.country);
  });

  test('edition reroll keeps the country and changes the edition, deterministically', () => {
    const base = { country: 'VEN', edition: 2023 };
    const a = rollEditionReroll('seed-r', 5, base, TEAMS);
    expect(a).toEqual(rollEditionReroll('seed-r', 5, base, TEAMS));
    expect(a.country).toBe('VEN');
    expect(a.edition).not.toBe(2023);
    expect(TEAMS[a.edition]).toContain('VEN');
  });

  // The strategy guides tell players the edition reroll gives "another Venezuela year at random".
  test('edition reroll lands on every other edition of the country, about evenly', () => {
    const six: EditionTeams = { 2006: ['VEN'], 2009: ['VEN'], 2013: ['VEN'], 2017: ['VEN'], 2023: ['VEN'], 2026: ['VEN'] };
    const n = 5000;
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const { edition } = rollEditionReroll(`spread-${i}`, i % 12, { country: 'VEN', edition: 2026 }, six);
      counts.set(edition, (counts.get(edition) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([2006, 2009, 2013, 2017, 2023]);
    for (const count of counts.values()) {
      expect(count / n).toBeGreaterThan(0.17);
      expect(count / n).toBeLessThan(0.23);
    }
  });

  test('edition reroll is unavailable for single-edition countries', () => {
    expect(canEditionReroll({ country: 'ESP', edition: 2013 }, TEAMS)).toBe(false);
    expect(canEditionReroll({ country: 'VEN', edition: 2023 }, TEAMS)).toBe(true);
  });

  test('each reroll can be used once per run', () => {
    let state = newDraft();
    state = markCountryReroll(state);
    expect(() => markCountryReroll(state)).toThrow();
    state = markEditionReroll(state);
    expect(() => markEditionReroll(state)).toThrow();
  });

  test('redraw rolls are deterministic per (seed, round, attempt)', () => {
    const a = rollRedraw('seed-d', 3, 1, TEAMS);
    expect(a).toEqual(rollRedraw('seed-d', 3, 1, TEAMS));
    expect(a).not.toEqual(rollRedraw('seed-d', 3, 2, TEAMS));
    expect(TEAMS[a.edition]).toContain(a.country);
  });
});

describe('draft state', () => {
  test('applyPick fills the slot and advances the round', () => {
    const state = newDraft();
    const player = makePlayer({ positions: ['SS'] });
    const next = applyPick(state, player, 'SS');
    expect(next.lineup.SS?.id).toBe(player.id);
    expect(next.round).toBe(1);
    expect(openSlots(next)).not.toContain('SS');
    expect(openSlots(state)).toContain('SS'); // original state untouched (pure)
  });

  test('rejects picks for slots the player cannot field', () => {
    const state = newDraft();
    expect(() => applyPick(state, makePlayer({ positions: ['LF'] }), 'CF')).toThrow();
  });

  test('rejects filling an occupied slot', () => {
    const state = applyPick(newDraft(), makePlayer({ positions: ['SS'] }), 'SS');
    expect(() => applyPick(state, makePlayer({ positions: ['SS'] }), 'SS')).toThrow();
  });

  test('the same human cannot be drafted twice, even from another edition', () => {
    const state = applyPick(newDraft(), makePlayer({ personKey: 'miggy|1983-04-18', positions: ['3B'], edition: 2013 }), '3B');
    const again = makePlayer({ personKey: 'miggy|1983-04-18', positions: ['1B'], edition: 2017 });
    expect(() => applyPick(state, again, '1B')).toThrow();
  });

  test('draft completes after all twelve slots are filled', () => {
    let state = newDraft();
    const slots = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'CL'] as const;
    for (const slot of slots) {
      expect(isComplete(state)).toBe(false);
      state = applyPick(state, makePlayer({ positions: [slot] }), slot);
    }
    expect(isComplete(state)).toBe(true);
    expect(openSlots(state)).toEqual([]);
  });
});

// A roster with no legal pick is redrawn for free (session.ts ensureLegal), so the strategy
// guides tell players a reroll is never needed for a roster where nobody fits.
describe('hasLegalPick', () => {
  const catcher = makePlayer({ personKey: 'catcher', positions: ['C'] });
  // C and DH filled: a pure catcher has nowhere left to go (DH takes any hitter while open).
  const withCatcherAndDh = applyPick(applyPick(newDraft(), catcher, 'C'), makePlayer({ positions: ['1B'] }), 'DH');

  test('is true when an undrafted player fits an open slot', () => {
    expect(hasLegalPick(newDraft(), [catcher])).toBe(true);
    expect(hasLegalPick(withCatcherAndDh, [makePlayer({ positions: ['C'] }), makePlayer({ positions: ['SS'] })])).toBe(true);
  });

  test('is false when every player is already drafted or fits only filled slots', () => {
    expect(hasLegalPick(withCatcherAndDh, [makePlayer({ positions: ['C'] })])).toBe(false);
    expect(hasLegalPick(withCatcherAndDh, [makePlayer({ personKey: 'catcher', positions: ['1B'] })])).toBe(false);
    expect(hasLegalPick(withCatcherAndDh, [])).toBe(false);
  });
});

describe('the same person on real data', () => {
  const players: EnginePlayer[] = JSON.parse(
    readFileSync(new URL('../../public/data/players.json', import.meta.url), 'utf-8'),
  ).players;
  const byId = new Map(players.map((p) => [p.id, p]));
  const firstOpenSlot = (state: ReturnType<typeof newDraft>, p: EnginePlayer) =>
    openSlots(state).find((slot) => isEligible(p.positions, slot));

  test.each([
    ['2006-pur-carlos-beltran', '2009-pur-carlos-beltran'],
    ['2013-kor-seunghwan-oh', '2017-kor-oh-seung-hwan'],
  ])('%s then %s into a second slot throws', (firstId, secondId) => {
    const first = byId.get(firstId)!;
    const second = byId.get(secondId)!;
    const state = applyPick(newDraft(), first, firstOpenSlot(newDraft(), first)!);
    const slot = firstOpenSlot(state, second);
    expect(slot).toBeDefined();
    expect(() => applyPick(state, second, slot!)).toThrow(/already on your team/);
  });
});
