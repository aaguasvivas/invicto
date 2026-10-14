// Guards for the language tables: every language must mirror the Spanish key
// tree exactly (Spanish is written first, by design), every flavor outcome
// type needs at least 8 variants so runs don't repeat text, and the copy rules
// (no em dash, the same placeholders as Spanish, Korean particles that never
// depend on an inserted word) hold for every string.

import { describe, expect, test } from 'vitest';
import { CATEGORIES } from '../engine/teamRating';
import type { HeroKind, Outcome, Stage } from '../engine/types';
import { BADGE_IDS } from '../game/badges';
import es from './es.json';
import en from './en.json';
import ja from './ja.json';
import ko from './ko.json';

const LANGS: [string, unknown][] = [
  ['en', en],
  ['ja', ja],
  ['ko', ko],
];
const ALL: [string, unknown][] = [['es', es], ...LANGS];

function keyTree(node: unknown, prefix = ''): string[] {
  if (Array.isArray(node)) return [`${prefix}[]`];
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => keyTree(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

/** Every string in a table with its path. Array items carry their index, so flavor[3] lines up across languages. */
function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

const placeholders = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** The node at a dot path, as t() resolves it. */
const at = (table: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], table);

type Panel = { icon: string; title: string; body: string };
const howtoPanels = (table: unknown): Panel[] => (table as { howto: { panels: Panel[] } }).howto.panels;
const flavorLists = (table: unknown): Record<string, string[]> => (table as { flavor: Record<string, string[]> }).flavor;

// Keys the code builds at runtime (t(`result.${run.outcome}`) and the like). The
// key-tree test only compares tables with each other, so a key the code asks for
// and no table has passes it. `satisfies` makes the type checker fail when a
// union in engine/types.ts gains a member these lists do not name.
const OUTCOMES = Object.keys({
  invicto: 1, campeon: 1, subcampeon: 1, 'eliminated-sf': 1, 'eliminated-qf': 1, 'eliminated-pool': 1,
} satisfies Record<Outcome, 1>);
const HERO_KINDS = Object.keys({
  slugger: 1, contact: 1, starter: 1, closer: 1, goatK: 1, goatBlown: 1,
} satisfies Record<HeroKind, 1>);
const STAGES = Object.keys({
  'pool-1': 1, 'pool-2': 1, 'pool-3': 1, 'pool-4': 1, qf: 1, sf: 1, final: 1,
} satisfies Record<Stage, 1>);
/** simulate.ts builds `${win|loss}-${kind}`. */
const FLAVOR_KEYS = ['win', 'loss'].flatMap((r) => ['mercy', 'shutout', 'blowout', 'walkoff', 'close', 'normal'].map((k) => `${r}-${k}`));

const DYNAMIC_KEYS = [
  ...OUTCOMES.flatMap((o) => [`result.${o}`, `result.${o}Sub`]), // result.ts
  ...OUTCOMES.filter((o) => o.startsWith('eliminated-')).map((o) => `result.stageShort.${o.replace('eliminated-', '')}`), // result.ts
  ...BADGE_IDS.flatMap((id) => [`badges.${id}.name`, `badges.${id}.desc`]), // result.ts
  ...[...HERO_KINDS, 'closerWin'].map((kind) => `hero.${kind}`), // sim.ts heroLine
  ...[...new Set(STAGES.map((s) => (s.startsWith('pool') ? 'pool' : s)))].map((s) => `sim.stages.${s}`), // sim.ts
  ...[...new Set(STAGES.map((s) => (s.startsWith('pool') ? 'pool' : s)))].map((s) => `challenge.stages.${s}`), // versus.ts games table
  ...['won', 'lost', 'tie'].map((verdict) => `challenge.${verdict}`), // versus.ts verdict line
  ...['C', 'IF', 'OF', 'DH', 'P'].map((group) => `draft.posGroups.${group}`), // draft.ts roster groups
  ...['minors', 'farm'].map((note) => `draft.${note}`), // draft.ts clubLabel
  ...CATEGORIES.map((c) => `scout.cat.${c}`), // scoutCard.ts bars and leverage line
  ...CATEGORIES.map((c) => `draft.cat.short.${c}`), // draft.ts tray bars and roster row tags
  ...['pool', 'qf', 'sf', 'final', 'campeon', 'invicto'].map((tier) => `stats.tier.${tier}`), // stats.ts chart rows
];

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

  for (const [code, table] of ALL) {
    test(`${code} has ≥8 flavor variants for each outcome type the engine deals`, () => {
      const flavors = flavorLists(table);
      expect(Object.keys(flavors).sort()).toEqual([...FLAVOR_KEYS].sort());
      for (const key of FLAVOR_KEYS) {
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

    test(`${code} resolves every key the code builds at runtime`, () => {
      expect(DYNAMIC_KEYS.filter((key) => typeof at(table, key) !== 'string')).toEqual([]);
    });

    test(`${code} has no em dash in any string`, () => {
      expect(leaves(table).filter(([, s]) => s.includes('\u2014')).map(([path]) => path)).toEqual([]);
    });
  }

  for (const [code, table] of LANGS) {
    test(`${code} fills the same {placeholders} as Spanish in every string`, () => {
      const spanish = new Map(leaves(es));
      const mismatches = leaves(table)
        .filter(([path, s]) => placeholders(s) !== placeholders(spanish.get(path) ?? ''))
        .map(([path, s]) => `${path}: ${s}`);
      expect(mismatches).toEqual([]);
    });

    test(`${code} has as many lines in each flavor list as Spanish`, () => {
      // The engine deals a variant index once; every language must have a line at that index.
      for (const key of FLAVOR_KEYS) {
        expect(flavorLists(table)[key].length, `${code} flavor.${key}`).toBe(flavorLists(es)[key].length);
      }
    });
  }

  test('ko never attaches a particle straight to a country, a name or a score', () => {
    // 은/는, 이/가, 을/를, 과/와 and 로/으로 change with the last sound of the
    // word before them, which a template cannot know: 일본 takes 은 but 미국 takes
    // 이, and a score ending in 0 reads 영 and takes 으로. Attach the particle to
    // a fixed word instead ("{opp} 타선이", "{opp} 벤치는").
    const attached = /\{(opp|name|us|them)\}(은|는|이|가|을|를|과|와|으로|로)/;
    expect(leaves(ko).filter(([, s]) => attached.test(s)).map(([path, s]) => `${path}: ${s}`)).toEqual([]);
  });
});
