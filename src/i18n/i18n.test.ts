// Guards for the language tables: every language must mirror the Spanish key
// tree exactly (Spanish is written first, by design), and every flavor outcome
// type needs at least 8 variants so runs don't repeat text.

import { describe, expect, test } from 'vitest';
import es from './es.json';
import en from './en.json';
import ja from './ja.json';
import ko from './ko.json';

const LANGS: [string, unknown][] = [
  ['en', en],
  ['ja', ja],
  ['ko', ko],
];

function keyTree(node: unknown, prefix = ''): string[] {
  if (Array.isArray(node)) return [`${prefix}[]`];
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => keyTree(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe('language tables', () => {
  const esTree = keyTree(es).sort();

  for (const [code, table] of LANGS) {
    test(`${code} mirrors the Spanish key tree`, () => {
      expect(keyTree(table).sort()).toEqual(esTree);
    });
  }

  for (const [code, table] of [['es', es] as [string, unknown], ...LANGS]) {
    test(`${code} has ≥8 flavor variants per outcome type`, () => {
      const flavors = (table as { flavor: Record<string, string[]> }).flavor;
      const keys = Object.keys(flavors);
      expect(keys).toHaveLength(12); // win/loss × mercy/shutout/blowout/walkoff/close/normal
      for (const key of keys) {
        expect(flavors[key].length, `${code} flavor.${key}`).toBeGreaterThanOrEqual(8);
      }
    });

    test(`${code} covers all 23 country names`, () => {
      const countries = (table as { countries: Record<string, string> }).countries;
      expect(Object.keys(countries)).toHaveLength(23);
    });
  }
});
