import { describe, expect, test } from 'vitest';
import { fold, nameSearch } from './search';

const roster = [{ name: 'Wily Mo Peña' }, { name: 'Ramón Hernández' }, { name: 'José Reyes' }, { name: 'David Ortiz' }];
const names = (query: string) => nameSearch(roster)(query).map((p) => p.name);

describe('roster search', () => {
  test('fold strips accents and case', () => {
    expect(fold('Peña')).toBe('pena');
    expect(fold('RAMÓN HERNÁNDEZ')).toBe('ramon hernandez');
    expect(fold('Jose')).toBe('jose');
  });

  test('a query typed without accents finds the accented name', () => {
    expect(names('pena')).toEqual(['Wily Mo Peña']);
    expect(names('hernandez')).toEqual(['Ramón Hernández']);
    expect(names('jose')).toEqual(['José Reyes']);
  });

  test('accents and capitals in the query are folded too', () => {
    expect(names('PEÑA')).toEqual(['Wily Mo Peña']);
    expect(names('Ramon Hernández')).toEqual(['Ramón Hernández']);
    expect(names('  ortiz ')).toEqual(['David Ortiz']);
  });

  test('a blank query keeps the whole roster, a miss keeps nothing', () => {
    expect(names('')).toHaveLength(4);
    expect(names('   ')).toHaveLength(4);
    expect(names('ichiro')).toEqual([]);
  });
});
