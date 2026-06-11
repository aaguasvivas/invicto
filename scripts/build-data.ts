// Invicto data pipeline. `npm run build-data`
//
// Wikipedia roster pages (cached in data-cache/wikipedia/) + SABR Lahman Database
// (data-cache/databank/) → public/data/players.json + public/data/editions.json
// (+ data/raw/scraped-players.json with pitchers kept for v2).
//
// Integrity: every player comes from a fetched roster page; nothing is invented.
// Methodology: see DATA.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { COUNTRIES } from './lib/countries.js';
import { DATABANK_SOURCE, loadDatabank, normalizeName } from './lib/databank.js';
import {
  bestMlbSeason, classifyLeague, clamp99, compositeToRating, defenseRating, matchPlayer,
  refinePositions, relScoreToRating, seededRng, speedScoreToRating,
  type Position, type RatedPlayer, type RatingMethod,
} from './lib/ratings.js';
import { EDITIONS, loadPage, parseEdition, type ScrapedPlayer } from './lib/wikipedia.js';

const LEAGUE_MULT: Record<string, number> = { mlb: 1.0, npb: 0.92, kbo: 0.85, cpbl: 0.78, cuba: 0.8, milb: 0.75, other: 0.7 };
const TIER_COMPOSITE = { A: 125, B: 100, C: 85 } as const;
const TWO_WAY_PA = 200; // a "pitcher" with a ≥200 PA MLB season near the edition bats (Ohtani rule)

async function main() {
  console.log('— Invicto data build —\n');

  // 1) Scrape
  const scraped: ScrapedPlayer[] = [];
  const editionTeams = new Map<number, Map<string, string>>();
  const editionSources = new Map<number, { url: string; retrievedAt: string }>();
  const warnings: string[] = [];
  for (const year of EDITIONS) {
    const { html, url, retrievedAt } = await loadPage(year);
    const source = { url, retrievedAt };
    const { players, teams, warnings: w } = parseEdition(year, html, source);
    if (teams.size < 16) throw new Error(`${year}: parsed only ${teams.size} teams — page structure changed, refusing to continue`);
    scraped.push(...players);
    editionTeams.set(year, teams);
    editionSources.set(year, source);
    for (const x of w) warnings.push(`${x.edition} [${x.country ?? '-'}] ${x.message}`);
  }
  console.log(`Scraped ${scraped.length} players across ${EDITIONS.length} editions`);
  for (const w of warnings) console.log(`  WARN ${w}`);

  // 2) Databank + ratings
  const db = loadDatabank();
  console.log('Databank loaded\n');

  const usedIds = new Set<string>();
  const methodCount: Record<string, number> = {};
  const rated: RatedPlayer[] = scraped.map((p) => {
    const slug = normalizeName(p.name).replace(/ /g, '-');
    let id = `${p.edition}-${p.country.toLowerCase()}-${slug}`;
    for (let i = 2; usedIds.has(id); i++) id = `${p.edition}-${p.country.toLowerCase()}-${slug}-${i}`;
    usedIds.add(id);
    const rng = seededRng(id);

    const match = matchPlayer(p, db);
    const offense = match ? bestMlbSeason(match.person, p.edition, db) : null;
    const isPitcher = p.posGroups.includes('P');
    const isTwoWay =
      isPitcher && match
        ? (db.battingByPlayer.get(match.person.playerID) ?? []).some((s) => Math.abs(s.year - p.edition) <= 1 && s.PA >= TWO_WAY_PA)
        : false;
    const excludedFromV1 = isPitcher && !isTwoWay;

    if (excludedFromV1) {
      // Pitchers are kept raw and unrated; v2 rates them from Pitching.csv.
      return {
        id, personKey: `${slug}|${p.dob ?? '?'}`, name: p.name, edition: p.edition, country: p.country,
        posGroup: p.posRaw, positions: [] as Position[], rating: 0, contact: 0, power: 0, speed: 0, defense: 0, clutch: 0,
        club: p.club, ratingMethod: 'heuristic' as RatingMethod, excludedFromV1: true, source: p.source,
      };
    }

    const positions = refinePositions(p, match, db);
    let composite: number;
    let method: RatingMethod;
    let contact: number, power: number, speed: number;
    if (offense) {
      composite = offense.composite;
      method = offense.method;
      contact = relScoreToRating(offense.contactScore);
      power = relScoreToRating(offense.powerScore);
      speed = speedScoreToRating(offense.speedScore);
    } else {
      const cls = match ? 'milb' : classifyLeague(p, db); // matched but never batted ≥100 PA ≈ org depth
      const age = p.dob ? p.edition - Number(p.dob.slice(0, 4)) : 27;
      const tier = age >= 23 && age <= 34 ? 'B' : 'C';
      composite = TIER_COMPOSITE[tier] * (LEAGUE_MULT[cls] ?? LEAGUE_MULT.other);
      method = 'heuristic';
      const base = compositeToRating(composite);
      contact = clamp99(Math.round(base - 2 + (rng() - 0.5) * 16));
      power = clamp99(Math.round(base - 8 + (rng() - 0.5) * 20));
      const speedPrior: Partial<Record<Position, number>> = { SS: 60, CF: 62, '2B': 58, LF: 52, RF: 52, '3B': 48, '1B': 40, C: 36, DH: 38 };
      const prior = Math.max(...positions.map((pos) => speedPrior[pos] ?? 50));
      speed = clamp99(Math.round(prior + (rng() - 0.5) * 20));
    }
    const defense = defenseRating(positions, match, p.edition, db, rng);
    // Overall: offense composite nudged by defensive/speed value (OPS+-scale points).
    const totalComposite = composite + (defense - 50) * 0.3 + ((speed ?? 50) - 50) * 0.15;
    const rating = clamp99(compositeToRating(totalComposite));
    const clutch = clamp99(Math.round(rating + (rng() - 0.5) * 10));
    methodCount[method] = (methodCount[method] ?? 0) + 1;

    return {
      id, personKey: `${slug}|${p.dob ?? '?'}`, name: p.name, edition: p.edition, country: p.country,
      posGroup: p.posRaw, positions, rating, contact, power, speed, defense, clutch,
      club: p.club, ratingMethod: method, excludedFromV1: false, source: p.source,
    };
  });

  const hitters = rated.filter((r) => !r.excludedFromV1);

  // 3) Validation ----------------------------------------------------------
  const errors: string[] = [];
  const flagged: string[] = [];

  const byTeam = new Map<string, RatedPlayer[]>();
  for (const r of rated) {
    const key = `${r.edition}-${r.country}`;
    (byTeam.get(key) ?? byTeam.set(key, []).get(key)!).push(r);
  }
  for (const [key, list] of byTeam) {
    if (list.length < 25 || list.length > 32) flagged.push(`${key}: ${list.length} players (outside 25–32)`);
    else if (list.length < 26 || list.length > 31) flagged.push(`${key}: ${list.length} players (outside 26–31)`);
    const teamHitters = list.filter((r) => !r.excludedFromV1);
    if (teamHitters.length < 9) errors.push(`${key}: only ${teamHitters.length} hitters — not draftable`);
  }
  for (const h of hitters) {
    if (h.positions.length === 0) errors.push(`${h.id}: hitter with no positions`);
    if (h.rating < 1 || h.rating > 99) errors.push(`${h.id}: rating ${h.rating} out of range`);
  }
  if (usedIds.size !== rated.length) errors.push('duplicate IDs detected');

  const spotChecks: [number, string, string[]][] = [
    [2017, 'NED', ['xander bogaerts', 'andrelton simmons', 'jurickson profar', 'jonathan schoop']],
    [2023, 'JPN', ['shohei ohtani']],
    [2026, 'VEN', ['maikel garcia', 'eugenio suarez']],
  ];
  for (const [year, country, names] of spotChecks) {
    const team = hitters.filter((h) => h.edition === year && h.country === country);
    for (const want of names) {
      if (!team.some((h) => normalizeName(h.name) === want)) {
        errors.push(`Spot check FAILED: ${want} not found among ${country} ${year} hitters`);
      }
    }
  }

  // 4) Report --------------------------------------------------------------
  console.log('=== Summary: players per team-edition — total(hitters) ===\n');
  const header = ['Country', ...EDITIONS.map(String)];
  const rows: string[][] = [];
  for (const c of COUNTRIES) {
    const row = [c.code];
    for (const year of EDITIONS) {
      const list = byTeam.get(`${year}-${c.code}`);
      row.push(list ? `${list.length}(${list.filter((r) => !r.excludedFromV1).length})` : '—');
    }
    rows.push(row);
  }
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]) => r.map((cell, i) => cell.padStart(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmt(r));

  console.log(`\nTotals: ${rated.length} players, ${hitters.length} hitters in v1 pool`);
  console.log(`Rating methods (hitters): ${JSON.stringify(methodCount)}`);

  console.log('\n=== Hitter rating histogram ===\n');
  const buckets = new Map<number, number>();
  for (const h of hitters) buckets.set(Math.floor(h.rating / 5) * 5, (buckets.get(Math.floor(h.rating / 5) * 5) ?? 0) + 1);
  const maxCount = Math.max(...buckets.values());
  for (let b = 0; b <= 95; b += 5) {
    const count = buckets.get(b) ?? 0;
    if (count === 0 && b < 20) continue;
    const bar = '█'.repeat(Math.round((count / maxCount) * 50));
    console.log(`${String(b).padStart(2)}-${String(b + 4).padEnd(2)} ${String(count).padStart(4)} ${bar}`);
  }
  const top = [...hitters].sort((a, b) => b.rating - a.rating).slice(0, 12);
  console.log('\nTop-rated hitters:');
  for (const t of top) console.log(`  ${t.rating}  ${t.name} — ${t.country} ${t.edition} (${t.ratingMethod})`);

  if (flagged.length) {
    console.log('\n=== Flagged for manual review (roster size) ===');
    for (const f of flagged) console.log(`  ${f}`);
  }
  if (errors.length) {
    console.error('\n=== VALIDATION ERRORS — BUILD FAILED ===');
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log('\n✓ Validation passed (sizes within review bounds, positions present, IDs unique, spot checks OK)');

  // 5) Write outputs -------------------------------------------------------
  mkdirSync('public/data', { recursive: true });
  mkdirSync('data/raw', { recursive: true });
  const publicHitters = hitters.map(({ excludedFromV1: _e, ...rest }) => rest);
  writeFileSync('public/data/players.json', JSON.stringify({ generatedAt: new Date().toISOString(), databank: DATABANK_SOURCE, players: publicHitters }));
  writeFileSync(
    'public/data/editions.json',
    JSON.stringify({
      editions: EDITIONS.map((year) => ({
        year,
        source: editionSources.get(year),
        teams: [...editionTeams.get(year)!.entries()].map(([code, pool]) => ({ code, pool })),
      })),
      countries: COUNTRIES,
    }),
  );
  writeFileSync('data/raw/scraped-players.json', JSON.stringify({ generatedAt: new Date().toISOString(), databank: DATABANK_SOURCE, players: rated }, null, 1));
  console.log('\nWrote public/data/players.json, public/data/editions.json, data/raw/scraped-players.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
