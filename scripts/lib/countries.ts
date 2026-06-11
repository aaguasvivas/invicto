// Canonical country table for every team that has appeared in a WBC (2006–2026).
// Wikipedia section headings vary across editions ("Taiwan" vs "Chinese Taipei"),
// so aliases map heading text → canonical code.

export interface Country {
  code: string;
  nameEn: string;
  nameEs: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { code: 'AUS', nameEn: 'Australia', nameEs: 'Australia', flag: '🇦🇺' },
  { code: 'BRA', nameEn: 'Brazil', nameEs: 'Brasil', flag: '🇧🇷' },
  { code: 'CAN', nameEn: 'Canada', nameEs: 'Canadá', flag: '🇨🇦' },
  { code: 'CHN', nameEn: 'China', nameEs: 'China', flag: '🇨🇳' },
  { code: 'COL', nameEn: 'Colombia', nameEs: 'Colombia', flag: '🇨🇴' },
  { code: 'CUB', nameEn: 'Cuba', nameEs: 'Cuba', flag: '🇨🇺' },
  { code: 'CZE', nameEn: 'Czech Republic', nameEs: 'Chequia', flag: '🇨🇿' },
  { code: 'DOM', nameEn: 'Dominican Republic', nameEs: 'República Dominicana', flag: '🇩🇴' },
  { code: 'ESP', nameEn: 'Spain', nameEs: 'España', flag: '🇪🇸' },
  { code: 'GBR', nameEn: 'Great Britain', nameEs: 'Gran Bretaña', flag: '🇬🇧' },
  { code: 'ISR', nameEn: 'Israel', nameEs: 'Israel', flag: '🇮🇱' },
  { code: 'ITA', nameEn: 'Italy', nameEs: 'Italia', flag: '🇮🇹' },
  { code: 'JPN', nameEn: 'Japan', nameEs: 'Japón', flag: '🇯🇵' },
  { code: 'KOR', nameEn: 'South Korea', nameEs: 'Corea del Sur', flag: '🇰🇷' },
  { code: 'MEX', nameEn: 'Mexico', nameEs: 'México', flag: '🇲🇽' },
  { code: 'NCA', nameEn: 'Nicaragua', nameEs: 'Nicaragua', flag: '🇳🇮' },
  { code: 'NED', nameEn: 'Netherlands', nameEs: 'Países Bajos', flag: '🇳🇱' },
  { code: 'PAN', nameEn: 'Panama', nameEs: 'Panamá', flag: '🇵🇦' },
  { code: 'PUR', nameEn: 'Puerto Rico', nameEs: 'Puerto Rico', flag: '🇵🇷' },
  { code: 'RSA', nameEn: 'South Africa', nameEs: 'Sudáfrica', flag: '🇿🇦' },
  { code: 'TPE', nameEn: 'Chinese Taipei', nameEs: 'Taipéi Chino', flag: '🇹🇼' },
  { code: 'USA', nameEn: 'United States', nameEs: 'Estados Unidos', flag: '🇺🇸' },
  { code: 'VEN', nameEn: 'Venezuela', nameEs: 'Venezuela', flag: '🇻🇪' },
];

const ALIASES: Record<string, string> = {
  taiwan: 'TPE',
  'chinese taipei': 'TPE',
  'south korea': 'KOR',
  korea: 'KOR',
  'czech republic': 'CZE',
  czechia: 'CZE',
  'great britain': 'GBR',
  'united kingdom': 'GBR',
  'united states': 'USA',
  netherlands: 'NED',
  'the netherlands': 'NED',
};

const byName = new Map<string, Country>();
for (const c of COUNTRIES) byName.set(c.nameEn.toLowerCase(), c);

/** Resolve a Wikipedia section heading to a canonical country, or null if it isn't a team. */
export function resolveCountry(heading: string): Country | null {
  const key = heading.trim().toLowerCase();
  const code = ALIASES[key];
  if (code) return COUNTRIES.find((c) => c.code === code)!;
  return byName.get(key) ?? null;
}
