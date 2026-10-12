// Person identity: which roster rows are the same real player. See DATA.md "Identity".
//
// The rating pass gives every row a provisional personKey `slug|dob`. One person can still
// hold several of them: a name written in another order (Oh Seung-hwan / Seunghwan Oh), a
// birth date missing in one edition, a birth-date typo, or a nickname. resolveIdentities()
// groups the rows with a union-find and gives each group one personKey, so the draft rule
// "already on your team" holds across editions. Record ids never change.

import { readFileSync } from 'node:fs';
import { nameLetters } from './databank.js';

export interface IdentityRow {
  id: string;
  personKey: string; // provisional `slug|dob` from the rating pass
  name: string;
  edition: number;
  country: string;
  dob: string | null;
  lahmanId: string | null;
}

/** data/curation/person-aliases.json: reviewed identity decisions, by record id. */
export interface PersonAliases {
  /** Rows of one person that no automatic rule links (nicknames, copied or mistyped birth dates). */
  aliases: { ids: string[]; note: string; source: string }[];
  /** Two rows with the same country and name letters that are different people. */
  distinct: { ids: string[]; note: string; source: string }[];
}

export interface IdentityResult {
  personKeys: Map<string, string>; // record id -> personKey
  persons: number;
  merged: number; // provisional keys folded into another person's key
  unions: Record<string, number>; // merges per rule
  warnings: string[];
  errors: string[];
}

type Rule = 'R2 same Lahman id' | 'R3 alias' | 'R1 same country and name letters';

const MIN_AGE = 16; // plausible age range at an edition, for a row without a birth date
const MAX_AGE = 47;

export function loadPersonAliases(): PersonAliases {
  return JSON.parse(readFileSync('data/curation/person-aliases.json', 'utf-8')) as PersonAliases;
}

/** Birth dates one typo apart: one of year, month and day differs, or month and day are swapped. */
export function typoClose(a: string, b: string): boolean {
  const [ya, ma, da] = a.split('-');
  const [yb, mb, db] = b.split('-');
  const differing = Number(ya !== yb) + Number(ma !== mb) + Number(da !== db);
  return differing <= 1 || (ya === yb && ma === db && da === mb);
}

const isJan1 = (dob: string | null) => dob !== null && dob.endsWith('-01-01');
/** Rows with a birth date first, then by edition and id. A person's first row gives their personKey. */
const datedFirst = (a: IdentityRow, b: IdentityRow) =>
  Number(!a.dob) - Number(!b.dob) || a.edition - b.edition || a.id.localeCompare(b.id);

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) (groups.get(k) ?? groups.set(k, []).get(k)!).push(item);
  }
  return groups;
}

export function resolveIdentities(rows: IdentityRow[], curation: PersonAliases): IdentityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unions: Record<string, number> = {};
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Curation entries must point at real rows and cite a source.
  const entries = [
    ...curation.aliases.map((e) => ({ list: 'aliases', ids: e.ids, source: e.source })),
    ...curation.distinct.map((e) => ({ list: 'distinct', ids: e.ids, source: e.source })),
  ];
  for (const { list, ids, source } of entries) {
    if (!/^https:\/\/\S+$/.test(source)) errors.push(`person-aliases ${list} [${ids.join(', ')}]: missing source URL`);
    for (const id of ids) if (!byId.has(id)) errors.push(`person-aliases ${list}: no record ${id}`);
  }
  for (const d of curation.distinct) {
    if (d.ids.length !== 2) errors.push(`person-aliases distinct [${d.ids.join(', ')}]: needs exactly two ids`);
  }

  const distinctPairs = new Set(curation.distinct.flatMap(({ ids: [a, b] }) => [`${a}|${b}`, `${b}|${a}`]));

  // Union-find. R0: rows that share a provisional key start as one person.
  const root = new Map<string, string>();
  const members = new Map<string, IdentityRow[]>();
  for (const group of groupBy(rows, (r) => r.personKey).values()) {
    members.set(group[0].id, group);
    for (const r of group) root.set(r.id, group[0].id);
  }
  const find = (id: string): string => {
    let r = id;
    while (root.get(r) !== r) r = root.get(r)!;
    return r;
  };

  /** Why rows A and B cannot be one person under this rule, or null. */
  function conflict(A: IdentityRow[], B: IdentityRow[], rule: Rule): string | null {
    for (const a of A) {
      for (const b of B) {
        if (a.edition === b.edition && a.country === b.country) return 'co-rostered';
        if (a.lahmanId && b.lahmanId && a.lahmanId !== b.lahmanId) return 'different Lahman ids';
        if (distinctPairs.has(`${a.id}|${b.id}`)) return 'listed as distinct';
        if (rule === 'R3 alias') continue;
        if (isJan1(a.dob) || isJan1(b.dob)) return 'Jan-1 birth date';
        if (rule !== 'R1 same country and name letters') continue;
        if (a.dob && b.dob) {
          if (!typoClose(a.dob, b.dob)) return 'birth dates differ';
        } else if (a.dob || b.dob) {
          const [dated, undated] = a.dob ? [a, b] : [b, a];
          const age = undated.edition - Number(dated.dob!.slice(0, 4));
          if (age < MIN_AGE || age > MAX_AGE) return 'implausible age';
        }
      }
    }
    return null;
  }

  function union(a: string, b: string, rule: Rule): string | null {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return null;
    const reason = conflict(members.get(ra)!, members.get(rb)!, rule);
    if (reason) return reason;
    root.set(rb, ra);
    members.set(ra, [...members.get(ra)!, ...members.get(rb)!]);
    members.delete(rb);
    unions[rule] = (unions[rule] ?? 0) + 1;
    return null;
  }

  // R2: one Lahman id is one person. A refusal means the rating join itself needs review.
  for (const [lahmanId, group] of groupBy(rows, (r) => r.lahmanId)) {
    const refused = new Set(group.slice(1).map((r) => union(group[0].id, r.id, 'R2 same Lahman id')).filter(Boolean));
    if (refused.size > 0) {
      warnings.push(`Lahman id ${lahmanId} is joined to rows that cannot be one person (${[...refused].join(', ')}): ${group.map((r) => r.id).join(', ')}`);
    }
  }

  // R3: reviewed aliases. They skip the birth-date checks but never the other guards.
  for (const { ids } of curation.aliases) {
    const known = ids.filter((id) => byId.has(id));
    for (const id of known.slice(1)) {
      const reason = union(known[0], id, 'R3 alias');
      if (reason) errors.push(`person-aliases alias [${ids.join(', ')}] refused: ${reason}`);
    }
  }

  // R1: same country and name letters with compatible birth dates. Dated rows merge among
  // themselves first; a row without a birth date then joins a person only when exactly one
  // candidate fits.
  const sameName = groupBy(rows, (r) => `${r.country}|${nameLetters(r.name)}`);
  for (const group of sameName.values()) {
    const ordered = [...group].sort(datedFirst);
    for (const r of ordered.slice(1)) {
      const own = find(r.id);
      const pool = r.dob ? ordered.filter((o) => o.dob) : ordered;
      const candidates = [...new Set(pool.map((o) => find(o.id)))].filter(
        (c) => c !== own && !conflict(members.get(c)!, members.get(own)!, 'R1 same country and name letters'),
      );
      if (!r.dob && candidates.length > 1) continue; // ambiguous: left for review below
      for (const c of candidates) union(c, r.id, 'R1 same country and name letters');
    }
  }

  // Every remaining same-country same-name split is a reviewed decision.
  for (const group of sameName.values()) {
    const people = [...new Set(group.map((r) => find(r.id)))];
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const A = members.get(people[i])!;
        const B = members.get(people[j])!;
        if (!A.some((a) => B.some((b) => distinctPairs.has(`${a.id}|${b.id}`)))) {
          errors.push(`same country and name letters but not listed as distinct: ${A.map((r) => r.id).join(' + ')} / ${B.map((r) => r.id).join(' + ')}`);
        }
      }
    }
  }

  // Final check of every person against the guards (R0 groups were never checked above).
  for (const group of members.values()) {
    const reason = group.map((r, i) => conflict([r], group.slice(i + 1), 'R3 alias')).find(Boolean);
    if (reason) errors.push(`person ${group.map((r) => r.id).join(' + ')} breaks a guard: ${reason}`);
  }

  // personKey: the key of the person's earliest row with a birth date (or earliest row), so a
  // person who had a single key keeps it.
  const personKeys = new Map<string, string>();
  for (const group of members.values()) {
    const key = [...group].sort(datedFirst)[0].personKey;
    for (const r of group) personKeys.set(r.id, key);
  }
  const provisional = new Set(rows.map((r) => r.personKey)).size;
  return { personKeys, persons: members.size, merged: provisional - members.size, unions, warnings, errors };
}
