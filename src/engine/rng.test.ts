import { describe, expect, test } from 'vitest';
import { rngFor } from './rng';

describe('rngFor', () => {
  test('same seed and path produce the same sequence', () => {
    const a = rngFor('seed-1', 'draft', 3);
    const b = rngFor('seed-1', 'draft', 3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('different paths produce different sequences', () => {
    const a = rngFor('seed-1', 'draft', 3);
    const b = rngFor('seed-1', 'draft', 4);
    const c = rngFor('seed-1', 'sim', 3);
    expect(a()).not.toBe(b());
    expect(rngFor('seed-1', 'draft', 3)()).not.toBe(c());
  });

  test('different seeds produce different sequences', () => {
    expect(rngFor('seed-1', 'x')()).not.toBe(rngFor('seed-2', 'x')());
  });

  test('values are in [0, 1)', () => {
    const rng = rngFor('seed-1', 'range');
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
