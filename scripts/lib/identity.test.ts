import { describe, expect, test } from 'vitest';
import { normalizeName } from './databank';
import { resolveIdentities, typoClose, type IdentityRow, type PersonAliases } from './identity';

const SOURCE = 'https://en.wikipedia.org/wiki/2009_World_Baseball_Classic_rosters';
const NONE: PersonAliases = { aliases: [], distinct: [], wrongLahmanJoins: [] };

/** A roster row as the rating pass emits it: provisional personKey = slug|dob. */
function row(edition: number, country: string, name: string, dob: string | null, lahmanId: string | null = null, suffix = ''): IdentityRow {
  const slug = normalizeName(name).replace(/ /g, '-');
  return { id: `${edition}-${country.toLowerCase()}-${slug}${suffix}`, personKey: `${slug}|${dob ?? '?'}`, name, edition, country, dob, lahmanId };
}

function keysOf(rows: IdentityRow[], curation = NONE) {
  const result = resolveIdentities(rows, curation);
  return { ...result, key: (r: IdentityRow) => result.personKeys.get(r.id) };
}

describe('typoClose', () => {
  test('accepts one differing field or a month/day swap', () => {
    expect(typoClose('1983-12-22', '1983-12-23')).toBe(true);
    expect(typoClose('1982-03-04', '1983-03-04')).toBe(true);
    expect(typoClose('1997-10-03', '1997-03-10')).toBe(true);
  });

  test('rejects two differing fields', () => {
    expect(typoClose('1989-09-01', '1989-10-27')).toBe(false);
    expect(typoClose('1980-08-07', '1981-08-16')).toBe(false);
  });
});

describe('resolveIdentities: merge rules', () => {
  test('rows that already share a key stay one person and keep that key (R0)', () => {
    const a = row(2009, 'DOM', 'Nelson Cruz', '1980-07-01');
    const b = row(2013, 'DOM', 'Nelson Cruz', '1980-07-01');
    const { key, persons, merged, errors } = keysOf([a, b]);
    expect(key(a)).toBe('nelson-cruz|1980-07-01');
    expect(key(b)).toBe('nelson-cruz|1980-07-01');
    expect(persons).toBe(1);
    expect(merged).toBe(0);
    expect(errors).toEqual([]);
  });

  test('the same Lahman id is one person, across spellings and countries (R2)', () => {
    const pan = row(2009, 'PAN', 'Bruce Chen', '1977-06-19', 'chenbr01');
    const chn = row(2017, 'CHN', 'Bruce Chen', '1977-06-19', 'chenbr01');
    const nori = row(2006, 'JPN', 'Nori Aoki', '1982-01-05', 'aokino01');
    const norichika = row(2009, 'JPN', 'Norichika Aoki', '1982-01-05', 'aokino01');
    const { key, errors } = keysOf([pan, chn, nori, norichika]);
    expect(key(chn)).toBe(key(pan));
    expect(key(norichika)).toBe(key(nori));
    expect(errors).toEqual([]);
  });

  test('a row without a birth date joins the one dated person of that name and country (R1)', () => {
    const y2006 = row(2006, 'PUR', 'Carlos Beltrán', null);
    const y2009 = row(2009, 'PUR', 'Carlos Beltrán', '1977-04-24');
    const { key, merged } = keysOf([y2006, y2009]);
    expect(key(y2006)).toBe('carlos-beltran|1977-04-24');
    expect(key(y2009)).toBe('carlos-beltran|1977-04-24');
    expect(merged).toBe(1);
  });

  test('a name written in another order with the same birth date is one person (R1)', () => {
    const oh = row(2009, 'KOR', 'Oh Seung-hwan', '1982-07-15');
    const flipped = row(2013, 'KOR', 'Seunghwan Oh', '1982-07-15');
    const { key } = keysOf([oh, flipped]);
    expect(key(flipped)).toBe('oh-seung-hwan|1982-07-15');
  });

  test('a one-field birth-date typo merges; two differing fields do not (R1)', () => {
    const cruz = row(2009, 'DOM', 'Nelson Cruz', '1980-07-01');
    const typo = row(2023, 'DOM', 'Nelson Cruz', '1980-06-01');
    expect(keysOf([cruz, typo]).key(typo)).toBe('nelson-cruz|1980-07-01');

    const tejada = row(2009, 'PAN', 'Rubén Tejada', '1989-09-01');
    const far = row(2023, 'PAN', 'Rubén Tejada', '1989-10-27');
    const apart = keysOf([tejada, far]);
    expect(apart.key(far)).not.toBe(apart.key(tejada));
  });

  test('R1 stays inside one country', () => {
    const a = row(2013, 'TPE', 'Chen Wei', '1990-05-05');
    const b = row(2017, 'CHN', 'Wei Chen', '1990-05-05');
    const { key } = keysOf([a, b]);
    expect(key(a)).not.toBe(key(b));
  });

  test('an alias group merges a nickname or a birth-date copy (R3)', () => {
    const steven = row(2023, 'NCA', 'Steven Leyton', '1998-12-17');
    const brandon = row(2026, 'NCA', 'Brandon Leyton', '1998-12-17');
    const curation: PersonAliases = { ...NONE, aliases: [{ ids: [steven.id, brandon.id], note: 'same article', source: SOURCE }] };
    const { key, errors } = keysOf([steven, brandon], curation);
    expect(key(brandon)).toBe(key(steven));
    expect(errors).toEqual([]);
  });

  test('a person keeps the key of their earliest row that has a birth date', () => {
    const r2006 = row(2006, 'PUR', 'Yadier Molina', null, 'molinya01');
    const r2009 = row(2009, 'PUR', 'Yadier Molina', '1982-07-13', 'molinya01');
    const r2013 = row(2013, 'PUR', 'Yadier Molina', '1982-07-13', 'molinya01');
    const { key } = keysOf([r2013, r2009, r2006]);
    for (const r of [r2006, r2009, r2013]) expect(key(r)).toBe('yadier-molina|1982-07-13');
  });

  test('a person with no birth date anywhere keeps the earliest row key', () => {
    const a = row(2006, 'ITA', 'Val Pascucci', null, 'pascuva01');
    const b = row(2009, 'ITA', 'Valentino Pascucci', null, 'pascuva01');
    expect(keysOf([b, a]).key(b)).toBe('val-pascucci|?');
  });
});

describe('resolveIdentities: guards', () => {
  test('never merges two rows of one team-edition, even with one Lahman id', () => {
    const alex = row(2017, 'AUS', 'Alex Wells', '1997-02-27', 'wellsal01');
    const lachlan = row(2017, 'AUS', 'Lachlan Wells', '1997-02-27', 'wellsal01');
    const { key, errors, warnings } = keysOf([alex, lachlan]);
    expect(key(alex)).not.toBe(key(lachlan));
    expect(errors).toEqual([]);
    expect(warnings.join('\n')).toContain('wellsal01');
  });

  test('never merges two different Lahman ids, and an alias that tries fails the build', () => {
    const a = row(2013, 'VEN', 'Carlos González', '1985-12-04', 'gomezca01');
    const b = row(2017, 'VEN', 'Carlos González', '1985-10-17', 'gonzaca01');
    const curation: PersonAliases = { ...NONE, aliases: [{ ids: [a.id, b.id], note: 'same article', source: SOURCE }] };
    const { key, errors } = keysOf([a, b], curation);
    expect(key(a)).not.toBe(key(b));
    expect(errors.join('\n')).toMatch(/alias .*different Lahman ids/);
  });

  test('a Jan-1 birth date merges only through an alias', () => {
    const dated = row(2017, 'CUB', 'Yosvany Alarcón', '1992-01-01');
    const undated = row(2023, 'CUB', 'Yosvany Alarcón', null);
    const split = keysOf([dated, undated]);
    expect(split.key(undated)).not.toBe(split.key(dated));

    const curation: PersonAliases = { ...NONE, aliases: [{ ids: [dated.id, undated.id], note: 'reviewed', source: SOURCE }] };
    expect(keysOf([dated, undated], curation).key(undated)).toBe('yosvany-alarcon|1992-01-01');
  });

  test('a row without a birth date stays apart when the age would be implausible', () => {
    const old = row(2006, 'PAN', 'Miguel Gómez', null);
    const young = row(2026, 'PAN', 'Miguel Gómez', '2001-09-10'); // 5 years old in 2006
    const { key } = keysOf([old, young]);
    expect(key(old)).not.toBe(key(young));
  });

  test('a row without a birth date and two candidate people is left for review', () => {
    const pitcher = row(2006, 'MEX', 'Édgar González', '1983-02-23', 'gonzaed01');
    const undated = row(2009, 'MEX', 'Edgar Gonzalez', null);
    const infielder = row(2013, 'MEX', 'Edgar Gonzalez', '1978-06-14', 'gonzaed02');
    const { key, errors } = keysOf([pitcher, undated, infielder]);
    expect(new Set([key(pitcher), key(undated), key(infielder)]).size).toBe(3);
    expect(errors.join('\n')).toContain('not listed as distinct');
  });

  test('an alias plus a distinct pair settles that case', () => {
    const pitcher = row(2006, 'MEX', 'Édgar González', '1983-02-23', 'gonzaed01');
    const undated = row(2009, 'MEX', 'Edgar Gonzalez', null);
    const infielder = row(2013, 'MEX', 'Edgar Gonzalez', '1978-06-14', 'gonzaed02');
    const curation: PersonAliases = {
      ...NONE,
      aliases: [{ ids: [undated.id, infielder.id], note: 'same article', source: SOURCE }],
      distinct: [{ ids: [pitcher.id, undated.id], note: 'pitcher vs infielder', source: SOURCE }],
    };
    const { key, errors, persons } = keysOf([pitcher, undated, infielder], curation);
    expect(key(undated)).toBe('edgar-gonzalez|1978-06-14');
    expect(key(pitcher)).toBe('edgar-gonzalez|1983-02-23');
    expect(persons).toBe(2);
    expect(errors).toEqual([]);
  });

  test('a distinct pair blocks every rule', () => {
    const a = row(2017, 'CUB', 'José Rodríguez', '1992-08-18');
    const b = row(2023, 'CUB', 'José Rodríguez', '1992-08-19');
    const curation: PersonAliases = { ...NONE, distinct: [{ ids: [a.id, b.id], note: 'unverified', source: SOURCE }] };
    const { key, errors } = keysOf([a, b], curation);
    expect(key(a)).not.toBe(key(b));
    expect(errors).toEqual([]);
  });

  test('a same-country same-letters split must be listed as distinct', () => {
    const catcher = row(2023, 'CHN', 'Chen Chen', null);
    const infielder = row(2023, 'CHN', 'Chen Chen', '1995-03-18', null, '-2');
    expect(keysOf([catcher, infielder]).errors.join('\n')).toContain('not listed as distinct');
    const curation: PersonAliases = { ...NONE, distinct: [{ ids: [catcher.id, infielder.id], note: 'co-rostered', source: SOURCE }] };
    expect(keysOf([catcher, infielder], curation).errors).toEqual([]);
  });
});

describe('resolveIdentities: curation file checks', () => {
  test('every alias and distinct record must exist', () => {
    const a = row(2009, 'ITA', 'Alex Maestri', '1985-06-01');
    const curation: PersonAliases = {
      aliases: [{ ids: [a.id, '2017-ita-nobody'], note: 'x', source: SOURCE }],
      distinct: [{ ids: [a.id, '2023-ita-nobody'], note: 'x', source: SOURCE }],
      wrongLahmanJoins: [],
    };
    const { errors } = keysOf([a], curation);
    expect(errors.join('\n')).toContain('2017-ita-nobody');
    expect(errors.join('\n')).toContain('2023-ita-nobody');
  });

  test('every entry cites a source URL', () => {
    const a = row(2009, 'ITA', 'Alex Maestri', '1985-06-01');
    const b = row(2017, 'ITA', 'Alessandro Maestri', '1985-06-01');
    const curation: PersonAliases = { ...NONE, aliases: [{ ids: [a.id, b.id], note: 'x', source: '' }] };
    expect(keysOf([a, b], curation).errors.join('\n')).toContain('source');
  });

  test('a wrong Lahman join is ignored for identity', () => {
    const a = row(2013, 'VEN', 'Carlos González', '1985-12-04', 'gomezca01');
    const b = row(2017, 'VEN', 'Carlos González', '1985-10-17', 'gonzaca01');
    const curation: PersonAliases = {
      ...NONE,
      aliases: [{ ids: [a.id, b.id], note: 'same article', source: SOURCE }],
      wrongLahmanJoins: [{ id: a.id, lahmanId: 'gomezca01', note: 'roster DOB is another player', source: SOURCE }],
    };
    const { key, errors } = keysOf([a, b], curation);
    expect(key(b)).toBe(key(a));
    expect(errors).toEqual([]);
  });

  test('a wrong-join entry fails once the rating join has changed', () => {
    const a = row(2013, 'VEN', 'Carlos González', '1985-10-17', 'gonzaca01');
    const curation: PersonAliases = {
      ...NONE,
      wrongLahmanJoins: [{ id: a.id, lahmanId: 'gomezca01', note: 'x', source: SOURCE }],
    };
    expect(keysOf([a], curation).errors.join('\n')).toMatch(/gomezca01.*gonzaca01|gonzaca01.*gomezca01/);
  });
});
