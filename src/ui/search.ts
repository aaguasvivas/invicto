// Roster search that ignores accents and case, so 'pena' finds Peña and
// 'hernandez' finds Hernández: players type names the way they say them.

/** Lowercase with the combining accents stripped (NFD, then U+0300-U+036F removed). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** A search over a fixed list: each name is folded once, each query once per call. */
export function nameSearch<T extends { name: string }>(items: T[]): (query: string) => T[] {
  const keys = items.map((item) => fold(item.name));
  return (query) => {
    const q = fold(query.trim());
    return items.filter((_, i) => keys[i].includes(q));
  };
}
