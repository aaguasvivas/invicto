// Rating computation. Full methodology is documented in DATA.md — keep the two in sync.
//
// Pipeline per scraped player:
//   1. Match against Lahman People (DOB+name first, then unique-name fallback).
//   2. MLB-matched: best season (PA ≥ 100) within edition ±1 year → approximate OPS+
//      composite. No season in window but one nearby: nearest season decayed 5%/yr
//      ("mlb-nearest"). Otherwise fall through to the heuristic path.
//   3. Unmatched: league-quality multiplier × tier baseline ("heuristic").
//   4. Composite → 1–99 rating through fixed anchors (not percentile), so a 99 stays rare.

import type { Databank, Person, SeasonBatting } from './databank.js';
import { normalizeName } from './databank.js';
import type { PosGroup, ScrapedPlayer } from './wikipedia.js';

export type Position = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';
export type RatingMethod = 'mlb-window' | 'mlb-nearest' | 'heuristic';

export interface RatedPlayer {
  id: string;
  personKey: string;
  name: string;
  edition: number;
  country: string;
  posGroup: string; // display: "IF", "OF", "C", "SS/3B", ...
  positions: Position[]; // slot eligibility (DH is implicit for everyone in the engine)
  rating: number;
  contact: number;
  power: number;
  speed: number;
  defense: number;
  clutch: number;
  club: string | null;
  ratingMethod: RatingMethod;
  excludedFromV1: boolean; // pitchers (non-two-way)
  source: { url: string; retrievedAt: string };
}

// League-quality multipliers for players without usable MLB stats (see DATA.md).
const LEAGUE_MULTIPLIERS: Record<string, number> = {
  mlb: 1.0,
  npb: 0.92,
  kbo: 0.85,
  cpbl: 0.78,
  cuba: 0.8,
  milb: 0.75,
  other: 0.7,
};

const LEAGUE_PATTERNS: [RegExp, string][] = [
  [/major league/i, 'mlb'],
  [/minor league|triple-a|double-a|complex league|^eastern league$|american association|atlantic league|frontier|pioneer|can-am|north american league/i, 'milb'],
  [/nippon|^npb$|japan central|japan pacific/i, 'npb'],
  [/kbo league|korea baseball organization/i, 'kbo'],
  [/chinese professional/i, 'cpbl'],
  [/cuban national/i, 'cuba'],
];

export function classifyLeague(p: ScrapedPlayer, db: Databank): string {
  if (p.leagueRaw) {
    for (const [re, cls] of LEAGUE_PATTERNS) if (re.test(p.leagueRaw)) return cls;
    return 'other';
  }
  if (p.club) {
    const clubNorm = normalizeName(p.club.replace(/\(farm\)/i, ''));
    if (/\(farm\)/i.test(p.club)) return 'milb';
    if (db.mlbClubNames.has(clubNorm)) return 'mlb';
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Matching

export interface Match {
  person: Person;
  method: 'dob+name' | 'name-unique';
}

function nameTokens(name: string): Set<string> {
  return new Set(normalizeName(name).split(' ').filter((t) => t.length > 1));
}

function tokensOverlap(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits;
}

export function matchPlayer(p: ScrapedPlayer, db: Databank): Match | null {
  const scraped = nameTokens(p.name);
  if (p.dob) {
    const candidates = db.peopleByDob.get(p.dob) ?? [];
    const scored = candidates
      .map((person) => ({
        person,
        overlap: tokensOverlap(scraped, nameTokens(`${person.nameFirst} ${person.nameLast}`)),
      }))
      .filter((c) => c.overlap >= 1)
      .sort((a, b) => b.overlap - a.overlap);
    if (scored.length === 1 || (scored.length > 1 && scored[0].overlap > scored[1].overlap)) {
      return { person: scored[0].person, method: 'dob+name' };
    }
    if (scored.length > 1) return null; // ambiguous same-DOB same-name: refuse to guess
  }
  // Name-unique fallback (also catches DOB typos between sources).
  const byName = db.peopleByName.get(normalizeName(p.name)) ?? [];
  const plausible = byName.filter((person) => {
    if (p.dob && person.birthDate) return false; // DOB known on both sides but didn't match above
    const debut = person.debutYear ?? 0;
    const final = person.finalYear ?? 9999;
    return debut <= p.edition + 1 && final >= p.edition - 25;
  });
  if (plausible.length === 1) return { person: plausible[0], method: 'name-unique' };
  return null;
}

// ---------------------------------------------------------------------------
// Offense composite (approximate OPS+)

interface SeasonScore {
  year: number;
  opsPlus: number;
  contactScore: number;
  powerScore: number;
  speedScore: number;
}

function scoreSeason(s: SeasonBatting, db: Databank): SeasonScore | null {
  const lg = db.leagueRates.get(`${s.year}-${s.lg}`);
  if (!lg) return null;
  const obpDen = s.AB + s.BB + s.HBP + s.SF;
  if (s.AB === 0 || obpDen === 0) return null;
  const tb = s.H + s.D + 2 * s.T + 3 * s.HR;
  const obp = (s.H + s.BB + s.HBP) / obpDen;
  const slg = tb / s.AB;
  const avg = s.H / s.AB;
  const iso = slg - avg;
  const kRate = s.PA > 0 ? s.SO / s.PA : lg.kRate;
  return {
    year: s.year,
    opsPlus: 100 * (obp / lg.obp + slg / lg.slg - 1),
    contactScore: avg / lg.avg - 0.5 * (kRate / lg.kRate - 1),
    powerScore: iso / lg.iso,
    speedScore: s.PA > 0 ? (s.SB + 2 * s.T) / s.PA : 0,
  };
}

export interface OffenseResult {
  composite: number; // OPS+ scale
  contactScore: number;
  powerScore: number;
  speedScore: number;
  method: 'mlb-window' | 'mlb-nearest';
}

export function bestMlbSeason(person: Person, edition: number, db: Databank): OffenseResult | null {
  const seasons = db.battingByPlayer.get(person.playerID) ?? [];
  const inWindow = seasons.filter((s) => Math.abs(s.year - edition) <= 1 && s.PA >= 100);
  const pick = (pool: SeasonBatting[]): SeasonScore | null => {
    let best: SeasonScore | null = null;
    for (const s of pool) {
      const sc = scoreSeason(s, db);
      if (sc && (!best || sc.opsPlus > best.opsPlus)) best = sc;
    }
    return best;
  };
  const windowBest = pick(inWindow);
  if (windowBest) {
    return { composite: windowBest.opsPlus, contactScore: windowBest.contactScore, powerScore: windowBest.powerScore, speedScore: windowBest.speedScore, method: 'mlb-window' };
  }
  // Nearest qualifying season within ±4 years, decayed 5% per year beyond the window.
  const nearby = seasons
    .filter((s) => Math.abs(s.year - edition) <= 4 && s.PA >= 200)
    .sort((a, b) => Math.abs(a.year - edition) - Math.abs(b.year - edition));
  if (nearby.length > 0) {
    const sc = scoreSeason(nearby[0], db);
    if (sc) {
      const dist = Math.max(0, Math.abs(sc.year - edition) - 1);
      return { composite: sc.opsPlus * (1 - 0.05 * dist), contactScore: sc.contactScore, powerScore: sc.powerScore, speedScore: sc.speedScore, method: 'mlb-nearest' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Composite → 1–99 rating via fixed anchors. composite is on the OPS+ scale.

const ANCHORS: [number, number][] = [
  [40, 18], [60, 30], [70, 38], [85, 50], [100, 62], [115, 72], [130, 80], [145, 87], [160, 92], [180, 96], [200, 99],
];

export function compositeToRating(composite: number): number {
  if (composite <= ANCHORS[0][0]) return ANCHORS[0][1];
  for (let i = 1; i < ANCHORS.length; i++) {
    const [x1, y1] = ANCHORS[i - 1];
    const [x2, y2] = ANCHORS[i];
    if (composite <= x2) {
      return Math.round(y1 + ((composite - x1) / (x2 - x1)) * (y2 - y1));
    }
  }
  return 99;
}

// ---------------------------------------------------------------------------
// Deterministic per-player RNG (build reproducibility; used for flavor stats only).

export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Position eligibility

const GROUP_POSITIONS: Record<PosGroup, Position[]> = {
  P: ['DH'], // two-way players that survive the pitcher filter bat as DH unless refined
  C: ['C'],
  IF: ['1B', '2B', '3B', 'SS'],
  OF: ['LF', 'CF', 'RF'],
  UTL: ['1B', '2B', '3B', 'SS', 'LF', 'RF'],
  DH: ['DH'],
  '1B': ['1B'], '2B': ['2B'], '3B': ['3B'], SS: ['SS'],
};

export function refinePositions(p: ScrapedPlayer, match: Match | null, db: Databank): Position[] {
  if (match) {
    const apps = db.appearancesByPlayer.get(match.person.playerID) ?? [];
    const windows = [
      apps.filter((a) => Math.abs(a.year - p.edition) <= 1),
      apps.filter((a) => Math.abs(a.year - p.edition) <= 4),
      apps,
    ];
    for (const win of windows) {
      const total = win.reduce((s, a) => s + a.G_all, 0);
      if (total < 20) continue;
      const byPos: Record<string, number> = {};
      for (const a of win) {
        for (const [pos, g] of Object.entries(a.byPos)) byPos[pos] = (byPos[pos] ?? 0) + g;
      }
      const eligible = (Object.entries(byPos) as [Position | 'P', number][])
        .filter(([pos, g]) => pos !== 'P' && g >= Math.max(10, total * 0.1))
        .sort((a, b) => b[1] - a[1])
        .map(([pos]) => pos as Position);
      if (eligible.length > 0) return eligible;
    }
  }
  const set = new Set<Position>();
  for (const g of p.posGroups) for (const pos of GROUP_POSITIONS[g]) set.add(pos);
  return [...set];
}

// Defense baseline by primary position; small quality adjustment from fielding stats for matched players.
const DEFENSE_BASELINE: Record<Position, number> = {
  C: 68, SS: 70, CF: 68, '2B': 60, '3B': 58, RF: 52, LF: 50, '1B': 42, DH: 25,
};

export function defenseRating(positions: Position[], match: Match | null, edition: number, db: Databank, rng: () => number): number {
  const base = Math.max(...positions.map((pos) => DEFENSE_BASELINE[pos]));
  let adj = 0;
  if (match) {
    const seasons = (db.fieldingByPlayer.get(match.person.playerID) ?? []).filter(
      (f) => Math.abs(f.year - edition) <= 1 && f.PO + f.A + f.E > 50,
    );
    const PO = seasons.reduce((s, f) => s + f.PO, 0);
    const A = seasons.reduce((s, f) => s + f.A, 0);
    const E = seasons.reduce((s, f) => s + f.E, 0);
    if (PO + A + E > 50) {
      const fpct = (PO + A) / (PO + A + E);
      adj = Math.max(-12, Math.min(12, (fpct - 0.975) * 400));
    }
  } else {
    adj = (rng() - 0.5) * 12;
  }
  return clamp99(Math.round(base + adj));
}

export function clamp99(v: number): number {
  return Math.max(1, Math.min(99, v));
}

// Map relative offensive scores (1.0 = league average) to 1–99 subratings.
// Anchored piecewise so the top compresses — 99 should be a couple dozen players, not a hundred.
const REL_ANCHORS: [number, number][] = [
  [0.4, 15], [0.6, 30], [0.8, 45], [1.0, 62], [1.3, 80], [1.6, 90], [2.0, 96], [2.6, 99],
];

export function relScoreToRating(rel: number): number {
  if (rel <= REL_ANCHORS[0][0]) return REL_ANCHORS[0][1];
  for (let i = 1; i < REL_ANCHORS.length; i++) {
    const [x1, y1] = REL_ANCHORS[i - 1];
    const [x2, y2] = REL_ANCHORS[i];
    if (rel <= x2) return clamp99(Math.round(y1 + ((rel - x1) / (x2 - x1)) * (y2 - y1)));
  }
  return 99;
}

export function speedScoreToRating(speedScore: number): number {
  // speedScore = (SB + 2·3B)/PA. 0.00 → 30, 0.04 → 62, 0.10+ → 95.
  return clamp99(Math.round(30 + speedScore * 800));
}
