import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { indexPeople, loadDatabank, type Databank, type Person } from './databank';
import { bestMlbPitching, bestMlbSeason, loadLahmanFixes, matchRoster, namesAgree, withRecordIds, type Match } from './ratings';
import { EDITIONS, parseDob, parseEdition, type ScrapedPlayer } from './wikipedia';

const SOURCE = { url: 'https://en.wikipedia.org/wiki/2023_World_Baseball_Classic_rosters', retrievedAt: '2026-06-11T00:00:00.000Z' };

/** A Lahman person with the fields matching reads. */
function person(playerID: string, nameFirst: string, nameLast: string, birthDate: string | null, birthCountry = 'USA', debutYear = 2005): Person {
  return {
    playerID, nameFirst, nameLast, birthDate, birthCountry,
    birthYear: birthDate ? Number(birthDate.slice(0, 4)) : null, debutYear, finalYear: null,
  };
}

/** A scraped roster row. */
function player(edition: number, country: string, name: string, dob: string | null): ScrapedPlayer {
  return { edition, country, pool: 'A', name, posRaw: 'IF', posGroups: ['IF'], dob, club: null, leagueRaw: null, source: SOURCE };
}

/** Lahman id each roster row joins, by record id (null when unmatched). */
function joins(players: ScrapedPlayer[], people: Person[], fixes = NO_FIXES) {
  const { matches, errors } = matchRoster(withRecordIds(players), indexPeople(people), fixes);
  expect(errors).toEqual([]);
  return Object.fromEntries([...matches].map(([id, m]) => [id, m?.person.playerID ?? null]));
}

const NO_FIXES: Parameters<typeof matchRoster>[2] = [];

const MCNEIL = person('mcneije01', 'Jeff', 'McNeil', '1992-04-08');
const MIKOLAS = person('mikolmi01', 'Miles', 'Mikolas', '1988-08-23');
const GOMEZ = person('gomezca01', 'Carlos', 'Gomez', '1985-12-04', 'D.R.');
const CARGO = person('gonzaca01', 'Carlos', 'Gonzalez', '1985-10-17', 'Venezuela');
const ALEX_WELLS = person('wellsal01', 'Alex', 'Wells', '1997-02-27', 'Australia', 2021);

describe('namesAgree', () => {
  test('a shared given name alone does not make the same person', () => {
    expect(namesAgree('Carlos González', GOMEZ, true)).toBe(false);
  });

  test('a shared surname alone does not make the same person', () => {
    expect(namesAgree('Lachlan Wells', ALEX_WELLS, true)).toBe(false);
  });

  test('accents, name order, hyphens and Jr. do not matter', () => {
    expect(namesAgree('Carlos González', CARGO, false)).toBe(true);
    expect(namesAgree('Kim Hyun-soo', person('kimhy01', 'Hyun Soo', 'Kim', null), false)).toBe(true);
    expect(namesAgree('Seunghwan Oh', person('ohse01', 'Seung-hwan', 'Oh', null), false)).toBe(true);
    expect(namesAgree('Bobby Witt Jr.', person('wittbo02', 'Bobby', 'Witt', null), false)).toBe(true);
  });

  test('a surname one letter off agrees only when it has five or more letters', () => {
    expect(namesAgree('José Villareal', person('villajo01', 'Jose', 'Villarreal', null), false)).toBe(true);
    expect(namesAgree('Jung Kin', person('kimju01', 'Jung', 'Kim', null), false)).toBe(false);
  });

  test('a given name agrees by prefix or a known nickname', () => {
    expect(namesAgree('Alex Rios', person('riosal01', 'Alexis', 'Rios', null), false)).toBe(true);
    expect(namesAgree('Bill Hall', person('hallbi03', 'William', 'Hall', null), false)).toBe(true);
    expect(namesAgree('Mike Piazza', person('piazzmi01', 'Michael', 'Piazza', null), false)).toBe(true);
  });

  test('a matching first initial counts only on an exact birth-date join', () => {
    const jacob = person('arrieja01', 'Jacob', 'Arrieta', null);
    expect(namesAgree('Jake Arrieta', jacob, true)).toBe(true);
    expect(namesAgree('Jake Arrieta', jacob, false)).toBe(false);
  });
});

describe('matchRoster: exact birth date', () => {
  test('joins the one person with that birth date and agreeing names', () => {
    expect(joins([player(2023, 'USA', 'Miles Mikolas', '1988-08-23')], [MIKOLAS])).toEqual({ '2023-usa-miles-mikolas': 'mikolmi01' });
  });

  test('refuses a birth-date match whose names only share a given name (Carlos González with Gómez’s date)', () => {
    const rows = [player(2013, 'VEN', 'Carlos González', '1985-12-04')];
    expect(joins(rows, [GOMEZ, CARGO])).toEqual({ '2013-ven-carlos-gonzalez': null });
  });

  test('refuses to guess between two people with that birth date and agreeing names', () => {
    const john = person('smithjo01', 'John', 'Smith', '1980-01-02');
    const johnny = person('smithjo05', 'Johnny', 'Smith', '1980-01-02');
    expect(joins([player(2006, 'USA', 'John Smith', '1980-01-02')], [john, johnny])).toEqual({ '2006-usa-john-smith': null });
  });

  test('refuses a twin who shares the birth date and surname', () => {
    const rows = [player(2026, 'AUS', 'Alex Wells', '1997-02-27'), player(2026, 'AUS', 'Lachlan Wells', '1997-02-27')];
    expect(joins(rows, [ALEX_WELLS])).toEqual({ '2026-aus-alex-wells': 'wellsal01', '2026-aus-lachlan-wells': null });
  });
});

describe('matchRoster: same-name fallback', () => {
  test('accepts a birth date one typo away: one field, or month and day swapped', () => {
    const pudge = person('rodriiv01', 'Ivan', 'Rodriguez', '1971-11-27', 'P.R.', 1991);
    const yariel = person('rodriya01', 'Yariel', 'Rodriguez', '1997-03-10', 'Cuba', 2024);
    const rows = [player(2009, 'PUR', 'Iván Rodríguez', '1971-11-30'), player(2026, 'CUB', 'Yariel Rodríguez', '1997-10-03')];
    expect(joins(rows, [pudge, yariel])).toEqual({ '2009-pur-ivan-rodriguez': 'rodriiv01', '2026-cub-yariel-rodriguez': 'rodriya01' });
  });

  test('accepts a roster birth date copied from a teammate (McNeil carries Mikolas’s date)', () => {
    const rows = [player(2023, 'USA', 'Miles Mikolas', '1988-08-23'), player(2023, 'USA', 'Jeff McNeil', '1988-08-23')];
    expect(joins(rows, [MIKOLAS, MCNEIL])).toEqual({ '2023-usa-miles-mikolas': 'mikolmi01', '2023-usa-jeff-mcneil': 'mcneije01' });
  });

  test('accepts a person whose real birth date sits on a teammate’s row (swapped dates)', () => {
    const tromp = person('trompch01', 'Chadwick', 'Tromp', '1995-03-21', 'Aruba', 2020);
    const rows = [player(2023, 'NED', 'Chadwick Tromp', '1993-04-26'), player(2023, 'NED', 'Sicnarf Loopstok', '1995-03-21')];
    expect(joins(rows, [tromp])['2023-ned-chadwick-tromp']).toBe('trompch01');
  });

  test('refuses a namesake whose birth date is far off (Kevin Kelly of the Netherlands)', () => {
    const kelly = person('kellyke02', 'Kevin', 'Kelly', '1997-11-28', 'USA', 2023);
    expect(joins([player(2023, 'NED', 'Kevin Kelly', '1990-05-27')], [kelly])).toEqual({ '2023-ned-kevin-kelly': null });
  });

  test('without the copy, a far-off date stays unmatched (McNeil alone)', () => {
    expect(joins([player(2023, 'USA', 'Jeff McNeil', '1988-08-23')], [MCNEIL])).toEqual({ '2023-usa-jeff-mcneil': null });
  });

  test('never hands out a person already joined to a teammate', () => {
    const rows = [player(2023, 'USA', 'Miles Mikolas', '1988-08-23'), player(2023, 'USA', 'Miles Mikolas', null)];
    expect(joins(rows, [MIKOLAS])).toEqual({ '2023-usa-miles-mikolas': 'mikolmi01', '2023-usa-miles-mikolas-2': null });
  });

  test('refuses when two namesakes fit, and when the career is out of range', () => {
    const twoNamesakes = [person('smithjo01', 'John', 'Smith', null), person('smithjo02', 'John', 'Smith', null)];
    expect(joins([player(2009, 'USA', 'John Smith', null)], twoNamesakes)).toEqual({ '2009-usa-john-smith': null });
    const debutsLater = person('smithjo03', 'John', 'Smith', null, 'USA', 2015);
    expect(joins([player(2009, 'USA', 'John Smith', null)], [debutsLater])).toEqual({ '2009-usa-john-smith': null });
  });

  test('finds a namesake listed in the other name order', () => {
    const oh = person('ohse01', 'Seung-hwan', 'Oh', '1982-07-15', 'South Korea', 2016);
    expect(joins([player(2017, 'KOR', 'Oh Seung-hwan', null)], [oh])).toEqual({ '2017-kor-oh-seung-hwan': 'ohse01' });
  });
});

describe('matchRoster: birthplace guard for rows without a birth date', () => {
  const dominicanRamirez = person('ramirra02', 'Ramon', 'Ramirez', '1981-08-31', 'D.R.', 2006);

  test('a Panama row without a birth date does not join a namesake born in the Dominican Republic', () => {
    expect(joins([player(2006, 'PAN', 'Ramón Ramírez', null)], [dominicanRamirez])).toEqual({ '2006-pan-ramon-ramirez': null });
  });

  test('it joins a namesake born in that country', () => {
    const panamanian = { ...dominicanRamirez, playerID: 'ramirra09', birthCountry: 'Panama' };
    expect(joins([player(2006, 'PAN', 'Ramón Ramírez', null)], [panamanian])).toEqual({ '2006-pan-ramon-ramirez': 'ramirra09' });
  });

  test('teams that field players born elsewhere skip the guard', () => {
    expect(joins([player(2006, 'ITA', 'Ramón Ramírez', null)], [dominicanRamirez])).toEqual({ '2006-ita-ramon-ramirez': 'ramirra02' });
  });

  test('a row with a birth date skips the guard', () => {
    expect(joins([player(2006, 'PAN', 'Ramón Ramírez', '1981-08-30')], [dominicanRamirez])).toEqual({ '2006-pan-ramon-ramirez': 'ramirra02' });
  });
});

describe('matchRoster: pinned joins from lahman-fixes.json', () => {
  const fix = (id: string, lahmanId: string | null) => ({ id, lahmanId, note: 'reviewed', source: 'https://en.wikipedia.org/wiki/X' });

  test('a pin overrides the matcher, and a null pin leaves the row unmatched', () => {
    const rows = [player(2013, 'VEN', 'Carlos González', '1985-12-04'), player(2006, 'PAN', 'Ramón Ramírez', null)];
    const people = [GOMEZ, CARGO, person('ramirra02', 'Ramon', 'Ramirez', null)];
    const fixes = [fix('2013-ven-carlos-gonzalez', 'gonzaca01'), fix('2006-pan-ramon-ramirez', null)];
    const { matches, errors } = matchRoster(withRecordIds(rows), indexPeople(people), fixes);
    expect(errors).toEqual([]);
    expect(matches.get('2013-ven-carlos-gonzalez')).toEqual<Match>({ person: CARGO, method: 'pinned' });
    expect(matches.get('2006-pan-ramon-ramirez')).toBeNull();
  });

  test('a pinned person is taken for the teammates’ fallback', () => {
    const rows = [player(2013, 'VEN', 'Carlos González', '1985-12-04'), player(2013, 'VEN', 'Carlos Gonzalez', null)];
    const fixes = [fix('2013-ven-carlos-gonzalez', 'gonzaca01')];
    expect(joins(rows, [CARGO], fixes)).toEqual({ '2013-ven-carlos-gonzalez': 'gonzaca01', '2013-ven-carlos-gonzalez-2': null });
  });

  test('a pin for a missing record, an unknown Lahman id or an uncited pin is an error', () => {
    const rows = withRecordIds([player(2013, 'VEN', 'Carlos González', null), player(2006, 'PAN', 'Ramón Ramírez', null)]);
    const { errors } = matchRoster(rows, indexPeople([CARGO]), [
      fix('2013-ven-nobody', 'gonzaca01'),
      fix('2013-ven-carlos-gonzalez', 'nobody01'),
      { ...fix('2006-pan-ramon-ramirez', null), source: '' },
    ]);
    expect(errors).toEqual([
      'lahman-fixes: no record 2013-ven-nobody',
      'lahman-fixes: 2013-ven-carlos-gonzalez pins unknown Lahman id nobody01',
      'lahman-fixes: 2006-pan-ramon-ramirez has no source URL',
    ]);
  });
});

describe('withRecordIds', () => {
  test('names a record edition-country-slug and numbers namesakes on one roster', () => {
    const rows = withRecordIds([player(2023, 'PUR', 'Edwin Díaz', '1994-03-22'), player(2023, 'PUR', 'Edwin Díaz', '1995-08-25')]);
    expect(rows.map((r) => r.id)).toEqual(['2023-pur-edwin-diaz', '2023-pur-edwin-diaz-2']);
  });
});

describe('parseDob', () => {
  test('reads the hidden ISO sort key first', () => {
    expect(parseDob('(1982-01-07)January 7, 1982 (age 27)')).toBe('1982-01-07');
    expect(parseDob('(1982-01-07)January 8, 1982 (age 27)')).toBe('1982-01-07');
  });

  test('falls back to the visible "Month D, YYYY" text', () => {
    expect(parseDob('February 26, 1983 (Age 26)')).toBe('1983-02-26');
    expect(parseDob('August 10, 1978 (Age 30)')).toBe('1978-08-10');
  });

  test('returns null when the cell has no date', () => {
    expect(parseDob('')).toBeNull();
    expect(parseDob('Unknown')).toBeNull();
  });
});

// The real joins this package exists for. Needs the gitignored caches (DATA.md "Sources").
const CACHED = existsSync('data-cache/databank/People.csv') && existsSync('data-cache/wikipedia/2026.html');

describe.skipIf(!CACHED)('real roster joins (Lahman and Wikipedia caches)', () => {
  let db: Databank;
  let matches: Map<string, Match | null>;
  let rows: ReturnType<typeof withRecordIds>;

  beforeAll(() => {
    db = loadDatabank();
    const meta = JSON.parse(readFileSync('data-cache/wikipedia/meta.json', 'utf-8'));
    const scraped = EDITIONS.flatMap((year) => parseEdition(year, readFileSync(`data-cache/wikipedia/${year}.html`, 'utf-8'), meta[year]).players);
    rows = withRecordIds(scraped);
    const result = matchRoster(rows, db, loadLahmanFixes());
    expect(result.errors).toEqual([]);
    matches = result.matches;
  }, 120_000);

  const joined = (id: string) => {
    expect(matches.has(id), `record ${id}`).toBe(true);
    return matches.get(id)?.person ?? null;
  };

  test.each([
    ['2023-usa-jeff-mcneil', 'mcneije01', 2023], // roster carries teammate Miles Mikolas's birth date
    ['2009-pur-ivan-rodriguez', 'rodriiv01', 2009], // roster 1971-11-30, Lahman 1971-11-27
    ['2013-dom-hanley-ramirez', 'ramirha01', 2013], // roster 1983-12-22, Lahman 1983-12-23
  ])('%s joins %s and rates from MLB seasons in the window', (id, lahmanId, edition) => {
    const person = joined(id);
    expect(person?.playerID).toBe(lahmanId);
    expect(bestMlbSeason(person!, edition, db)?.method).toBe('mlb-window');
  });

  test('2009 Odalis Pérez (typo in the birth year) rates from his 2008 season', () => {
    const person = joined('2009-dom-odalis-perez');
    expect(person?.playerID).toBe('perezod01');
    expect(bestMlbPitching(person!, 2009, db)?.method).toBe('mlb-window');
  });

  test('Kevin Kelly of the Netherlands stays unmatched in every edition', () => {
    const kellys = rows.filter((r) => r.id.endsWith('-ned-kevin-kelly'));
    expect(kellys.length).toBe(3);
    for (const r of kellys) expect(joined(r.id)).toBeNull();
  });

  test('the wrong joins are gone: CarGo 2013, the Wells twins, 2006 Panama Ramón Ramírez', () => {
    expect(joined('2013-ven-carlos-gonzalez')?.playerID).toBe('gonzaca01');
    expect(joined('2017-aus-lachlan-wells')).toBeNull();
    expect(joined('2026-aus-lachlan-wells')).toBeNull();
    expect(joined('2026-aus-alex-wells')?.playerID).toBe('wellsal01');
    expect(joined('2006-pan-ramon-ramirez')).toBeNull();
  });

  test('2009 Mexico birth dates come from the visible text, so Edgar González joins without a pin', () => {
    const edgar = rows.find((r) => r.id === '2009-mex-edgar-gonzalez')!;
    expect(edgar.player.dob).toBe('1978-06-14');
    expect(joined(edgar.id)?.playerID).toBe('gonzaed02');
    expect(loadLahmanFixes().some((f) => f.id === edgar.id)).toBe(false);
  });
});
