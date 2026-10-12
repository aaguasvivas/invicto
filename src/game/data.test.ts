// Invariants of the shipped dataset. One real player holds one personKey, so the draft
// rule "already on your team" holds across editions and name spellings. The build side of
// these rules: scripts/lib/identity.ts and DATA.md "Identity".
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { EnginePlayer } from '../engine/types';

const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8'));
/** A shipped record: the engine fields plus how the rating was made (DATA.md "Ratings"). */
type ShippedPlayer = EnginePlayer & { ratingMethod: string };
const players: ShippedPlayer[] = readJson('public/data/players.json').players;
const curation: { aliases: { ids: string[] }[]; distinct: { ids: string[] }[] } = readJson('data/curation/person-aliases.json');

const byId = new Map(players.map((p) => [p.id, p]));
const keyOf = (id: string) => byId.get(id)?.personKey;
const slugOf = (key: string) => key.split('|')[0];
const dobOf = (key: string) => key.split('|')[1];
const sortedLetters = (slug: string) => [...slug.replace(/-/g, '')].sort().join('');

/** personKeys that a 'distinct' entry declares to be different people. */
const distinctKeyPairs = new Set(
  curation.distinct.flatMap(({ ids: [a, b] }) => [`${keyOf(a)}~${keyOf(b)}`, `${keyOf(b)}~${keyOf(a)}`]),
);

function rowsByKey(): Map<string, EnginePlayer[]> {
  const map = new Map<string, EnginePlayer[]>();
  for (const p of players) (map.get(p.personKey) ?? map.set(p.personKey, []).get(p.personKey)!).push(p);
  return map;
}

describe('person identity in players.json', () => {
  test('no personKey repeats within one team-edition', () => {
    const seen = new Set<string>();
    const repeats = players.filter((p) => {
      const k = `${p.edition}-${p.country}-${p.personKey}`;
      return seen.has(k) || !seen.add(k);
    });
    expect(repeats.map((p) => p.id)).toEqual([]);
  });

  test('no two personKeys share sorted name letters and a birth date', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const key of rowsByKey().keys()) {
      if (dobOf(key) === '?') continue;
      const sig = `${sortedLetters(slugOf(key))}|${dobOf(key)}`;
      const other = owner.get(sig);
      if (other && !distinctKeyPairs.has(`${other}~${key}`)) clashes.push(`${other} / ${key}`);
      owner.set(sig, key);
    }
    expect(clashes).toEqual([]);
  });

  test('an undated key never shares slug and country with a dated key, unless listed as distinct', () => {
    const groups = rowsByKey();
    const countries = (key: string) => new Set(groups.get(key)!.map((p) => p.country));
    const clashes: string[] = [];
    for (const undated of groups.keys()) {
      if (dobOf(undated) !== '?') continue;
      for (const dated of groups.keys()) {
        if (dated === undated || slugOf(dated) !== slugOf(undated)) continue;
        const shared = [...countries(undated)].some((c) => countries(dated).has(c));
        if (shared && !distinctKeyPairs.has(`${undated}~${dated}`)) clashes.push(`${undated} / ${dated}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  test('every alias group in person-aliases.json shares one personKey', () => {
    for (const { ids } of curation.aliases) {
      expect(new Set(ids.map(keyOf)).size, ids.join(', ')).toBe(1);
      expect(keyOf(ids[0]), ids[0]).toBeDefined();
    }
  });

  test('every distinct pair in person-aliases.json holds two personKeys', () => {
    for (const { ids: [a, b] } of curation.distinct) {
      expect(keyOf(a), a).toBeDefined();
      expect(keyOf(b), b).toBeDefined();
      expect(keyOf(a), `${a} / ${b}`).not.toBe(keyOf(b));
    }
  });

  test.each([
    ['2006-pur-carlos-beltran', '2009-pur-carlos-beltran'], // no birth date in 2006
    ['2013-kor-seunghwan-oh', '2017-kor-oh-seung-hwan'], // name order
    ['2006-kor-lee-seung-yeop', '2013-kor-seungyeop-lee'], // name order
    ['2009-pan-ruben-tejada', '2023-pan-ruben-tejada'], // birth-date typo, same article
  ])('%s and %s are one person', (a, b) => {
    expect(keyOf(a)).toBeDefined();
    expect(keyOf(a)).toBe(keyOf(b));
  });

  test('DATA.md cites the distinct-player count of the shipped file', () => {
    const doc = readFileSync(new URL('../../DATA.md', import.meta.url), 'utf-8');
    const cited = doc.match(/([\d,]+) distinct players/)?.[1];
    expect(cited?.replace(/,/g, '')).toBe(String(rowsByKey().size));
  });
});

// Records the 2026-10 rating refresh fixed (DATA.md "Data refresh log"). A rebuild that brings
// back a wrong Lahman join, a lost join or the minor-league rate for a foreign-league regular
// fails here.
describe('rating spot checks in players.json', () => {
  const record = (id: string) => {
    const p = byId.get(id);
    expect(p, id).toBeDefined();
    return p!;
  };

  test.each([
    ['2023-usa-jeff-mcneil', 70], // 2022 NL batting champion; the roster carries a teammate's birth date
    ['2009-pur-ivan-rodriguez', 55], // birth-date typo on the roster
    ['2013-dom-hanley-ramirez', 85], // birth-date typo on the roster
  ])('%s rates from his MLB seasons (at least %i)', (id, min) => {
    expect(record(id).ratingMethod).toBe('mlb-window');
    expect(record(id).rating).toBeGreaterThanOrEqual(min);
  });

  test('2013 Carlos González has his own stats, not Carlos Gómez’s', () => {
    expect(record('2013-ven-carlos-gonzalez').positions).toEqual(['LF']);
  });

  test('2006 Panama Ramón Ramírez no longer carries a Dominican reliever’s stats', () => {
    expect(record('2006-pan-ramon-ramirez').ratingMethod).toBe('heuristic');
  });

  test('Lachlan Wells keeps his own pitcher roles, not his twin’s', () => {
    expect(record('2017-aus-lachlan-wells').positions).toContain('CL');
    expect(record('2026-aus-lachlan-wells').positions).toContain('CL');
  });

  test('a foreign-league regular with an old MLB stint is not rated as a minor leaguer', () => {
    expect(record('2006-ned-randall-simon').rating).toBeGreaterThan(45); // Orix 2006
    expect(record('2017-jpn-shintaro-fujinami').rating).toBeGreaterThan(50); // Hanshin 2017
  });
});
