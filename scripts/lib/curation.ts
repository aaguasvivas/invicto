// Curated tiers for foreign-league stars (and stars mis-served by bad MLB
// stints). See DATA.md "Curated foreign stars".
//
// Integrity rules:
//  - An entry can only LIFT a real scraped player: (edition, exact roster name)
//    must match a scraped player or the build FAILS. Curation can never add a
//    player that wasn't on the page.
//  - Every entry cites a Wikipedia article. The build fetches it (cached) and
//    fails on HTTP errors; it warns if the article doesn't mention the claimed
//    league, so a wrong citation can't slip through silently.
//  - The tier composite is multiplied by the player's league-quality multiplier
//    and applied as max(computed, curated) — it never lowers anyone.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface CurationEntry {
  edition: number;
  country: string;
  name: string; // exact roster spelling for that edition
  tier: 'S' | 'A+' | 'A' | 'B+';
  note: string;
  source: string; // Wikipedia article URL
}

/** OPS+-equivalent composite per tier, before the league multiplier. */
export const TIER_VALUES: Record<CurationEntry['tier'], number> = {
  S: 150, // generational: the best player in a top foreign league
  'A+': 135, // MVP-level star
  A: 125, // All-Star level
  'B+': 110, // quality regular with real accomplishments
};

const LEAGUE_KEYWORDS = [
  'Nippon Professional Baseball', 'NPB', 'Central League', 'Pacific League',
  'KBO', 'Korea Baseball',
  'Chinese Professional Baseball', 'CPBL',
  'Cuban National Series', 'Serie Nacional', 'Cuban baseball',
];

const CACHE_DIR = 'data-cache/wikipedia/players';

export function loadCuration(): CurationEntry[] {
  return JSON.parse(readFileSync('data/curation/foreign-stars.json', 'utf-8')) as CurationEntry[];
}

/**
 * Verify every entry's citation: the article must exist; it should mention one
 * of the foreign-league keywords. Returns warnings; throws on hard failures.
 */
export async function verifyCuration(entries: CurationEntry[]): Promise<string[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const warnings: string[] = [];
  const failures: string[] = [];
  for (const entry of entries) {
    const slug = entry.source.split('/wiki/')[1];
    if (!slug) {
      failures.push(`${entry.edition} ${entry.name}: source is not a Wikipedia article URL`);
      continue;
    }
    const cacheFile = `${CACHE_DIR}/${decodeURIComponent(slug).replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    let html: string;
    if (existsSync(cacheFile)) {
      html = readFileSync(cacheFile, 'utf-8');
    } else {
      const res = await fetch(entry.source, {
        headers: { 'User-Agent': 'InvictoDataBuild/0.1 (personal project; aaguasvivas907@gmail.com)' },
        redirect: 'follow',
      });
      if (!res.ok) {
        failures.push(`${entry.edition} ${entry.name}: HTTP ${res.status} for ${entry.source}`);
        continue;
      }
      html = await res.text();
      writeFileSync(cacheFile, html);
      await new Promise((r) => setTimeout(r, 250)); // be polite to Wikipedia
    }
    if (!LEAGUE_KEYWORDS.some((kw) => html.includes(kw))) {
      warnings.push(`${entry.edition} ${entry.name}: article does not mention a known foreign league — check the citation`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Curation citation failures:\n  ${failures.join('\n  ')}`);
  }
  return warnings;
}
