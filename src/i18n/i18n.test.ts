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

type Panel = { icon: string; title: string; body: string };
const howtoPanels = (table: unknown): Panel[] => (table as { howto: { panels: Panel[] } }).howto.panels;

describe('language tables', () => {
  const esTree = keyTree(es).sort();

  test('How to play has four panels: the draft, who plays where, the rerolls, the tournament', () => {
    expect(howtoPanels(es).map((p) => p.icon)).toEqual(['🎰', '🧤', '🔁', '🏆']);
  });

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

    test(`${code} has the How to play panels of the Spanish table, in its order`, () => {
      // The parity test above sees an array as one key, so a missing panel would pass it.
      const panels = howtoPanels(table);
      expect(panels.map((p) => p.icon)).toEqual(howtoPanels(es).map((p) => p.icon));
      for (const p of panels) {
        expect(p.title.trim(), `${code} ${p.icon} title`).not.toBe('');
        expect(p.body.trim(), `${code} ${p.icon} body`).not.toBe('');
      }
    });

    test(`${code} covers all 23 country names`, () => {
      const countries = (table as { countries: Record<string, string> }).countries;
      expect(Object.keys(countries)).toHaveLength(23);
    });
  }
});
