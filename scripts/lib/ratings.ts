// Rating computation. Full methodology is documented in DATA.md; keep the two in sync.
//
// Pipeline per scraped player:
//   1. Match against Lahman People: a pinned join, else exact DOB with agreeing names,
//      else a unique same-name person whose DOB differs only by a known kind of error.
//   2. MLB-matched: best season (PA ≥ 100) within edition ±1 year → approximate OPS+
//      composite. No season in window but one nearby: nearest season decayed 5%/yr
//      ("mlb-nearest"). Otherwise fall through to the heuristic path.
//   3. Unmatched: league-quality multiplier × tier baseline ("heuristic").
//   4. Composite → 1–99 rating through fixed anchors (not percentile), so a 99 stays rare.

import { readFileSync } from 'node:fs';
import type { Databank, PeopleIndex, Person, SeasonBatting, SeasonPitching } from './databank.js';
import { nameLetters, normalizeName } from './databank.js';
import { typoClose } from './identity.js';
import type { PosGroup, ScrapedPlayer } from './wikipedia.js';

export type Position = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'SP' | 'RP' | 'CL';
export type RatingMethod = 'mlb-window' | 'mlb-nearest' | 'heuristic' | 'curated';

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

const LEAGUE_PATTERNS: [RegExp, string][] = [
  [/major league/i, 'mlb'],
  [/minor league|triple-a|double-a|complex league|^eastern league$|american association|atlantic league|frontier|pioneer|can-am|north american league/i, 'milb'],
  [/nippon|^npb$|japan central|japan pacific/i, 'npb'],
  [/kbo league|korea baseball organization/i, 'kbo'],
  [/chinese professional/i, 'cpbl'],
  [/cuban national/i, 'cuba'],
];

/**
 * Build club → league-class pairs from every roster row that has an explicit
 * League column (2013/2017/2026 and half of 2023). The 2006/2009 pages only
 * list clubs, so "Yomiuri Giants" etc. resolve through this map.
 */
export function buildClubLeagueMap(players: ScrapedPlayer[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const p of players) {
    if (!p.leagueRaw || !p.club) continue;
    let cls = 'other';
    for (const [re, c] of LEAGUE_PATTERNS) if (re.test(p.leagueRaw)) { cls = c; break; }
    const club = normalizeName(p.club.replace(/\(farm\)/i, ''));
    if (!club) continue;
    const v = votes.get(club) ?? votes.set(club, new Map()).get(club)!;
    v.set(cls, (v.get(cls) ?? 0) + 1);
  }
  const map = new Map<string, string>();
  for (const [club, v] of votes) {
    map.set(club, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return map;
}

export function classifyLeague(p: ScrapedPlayer, db: Databank, clubLeagues?: Map<string, string>): string {
  if (p.leagueRaw) {
    for (const [re, cls] of LEAGUE_PATTERNS) if (re.test(p.leagueRaw)) return cls;
    return 'other';
  }
  if (p.club) {
    const clubNorm = normalizeName(p.club.replace(/\(farm\)/i, ''));
    if (/\(farm\)/i.test(p.club)) return 'milb';
    if (db.mlbClubNames.has(clubNorm)) return 'mlb';
    const fromMap = clubLeagues?.get(clubNorm);
    if (fromMap) return fromMap;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Matching roster rows to Lahman people (DATA.md "Matching roster names to Lahman IDs")

export interface Match {
  person: Person;
  method: 'dob+name' | 'name' | 'pinned';
}

/** A scraped roster row with its record id. */
export interface RosterRow {
  id: string;
  player: ScrapedPlayer;
}

/** data/curation/lahman-fixes.json: reviewed joins the matcher cannot make, by record id. */
export interface LahmanFix {
  id: string;
  lahmanId: string | null; // null: the row stays unmatched
  note: string;
  source: string;
}

export function loadLahmanFixes(): LahmanFix[] {
  return JSON.parse(readFileSync('data/curation/lahman-fixes.json', 'utf-8')) as LahmanFix[];
}

/**
 * Record ids: `<edition>-<country>-<name slug>`, then -2, -3 for namesakes on one roster.
 * Saved runs and the daily stats store them, so the scheme never changes.
 */
export function withRecordIds(players: ScrapedPlayer[]): RosterRow[] {
  const used = new Set<string>();
  return players.map((player) => {
    const slug = normalizeName(player.name).replace(/ /g, '-');
    const base = `${player.edition}-${player.country.toLowerCase()}-${slug}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    return { id, player };
  });
}

const NICKNAMES: Record<string, string> = { mike: 'michael', manny: 'manuel', bill: 'william', willie: 'william', bob: 'robert', bobby: 'robert', tony: 'anthony', jim: 'james' };
const nicknameOf = (a: string, b: string) => NICKNAMES[a] === b || NICKNAMES[b] === a;
const nameTokens = (name: string) => normalizeName(name).split(' ').filter((t) => t.length > 1);

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + Number(a[i - 1] !== b[j - 1]));
    prev = row;
  }
  return prev[b.length];
}

/**
 * Do a roster name and a Lahman person name the same player? The surname must agree
 * (one letter of slack from five letters up: Villareal, Villarreal) and so must the given
 * name: equal, the same first three letters, or a known nickname. On an exact birth-date
 * join the same first initial is enough. A name without given names ("C. C. Lee") passes.
 */
export function namesAgree(rosterName: string, person: Pick<Person, 'nameFirst' | 'nameLast'>, exactDob: boolean): boolean {
  const roster = nameTokens(rosterName);
  const surname = nameTokens(person.nameLast).join('');
  if (!surname) return false;
  const nearSurname = (t: string) => surname.length >= 5 && levenshtein(t, surname) <= 1;
  if (!roster.join('').includes(surname) && !roster.some(nearSurname)) return false;
  const given = roster.filter((t) => !surname.includes(t) && !nearSurname(t) && t !== 'jr');
  const first = nameTokens(person.nameFirst);
  if (first.length === 0 || given.length === 0) return true;
  return first.some((f) =>
    given.some((g) => g === f || g.slice(0, 3) === f.slice(0, 3) || nicknameOf(g, f) || (exactDob && g[0] === f[0])),
  );
}

/** Lahman birthCountry for teams whose players are born in the country (no heritage rosters). */
const HOME_BIRTH_COUNTRY: Record<string, string> = {
  PAN: 'Panama', DOM: 'D.R.', VEN: 'Venezuela', CUB: 'Cuba', JPN: 'Japan',
  KOR: 'South Korea', TPE: 'Taiwan', COL: 'Colombia', NCA: 'Nicaragua', CHN: 'China',
};

interface TeamContext {
  dobs: Map<string, number>; // roster birth date -> rows of this team-edition that carry it
  joined: Set<string>; // Lahman ids joined in pass 1 to a row of this team-edition
}

/** A roster birth date that differs from Lahman is still the same player when it is a known kind of error. */
function birthDateExplained(p: ScrapedPlayer, person: Person, team: TeamContext): boolean {
  if (!p.dob || !person.birthDate) return true;
  return (
    typoClose(p.dob, person.birthDate) || // one field off, or month and day swapped
    (team.dobs.get(p.dob) ?? 0) > 1 || // the roster copied a teammate's date
    team.dobs.has(person.birthDate) // the player's real date sits on a teammate's row
  );
}

/**
 * Join every roster row to a Lahman person in two passes, because the fallback needs to
 * know what the rest of the roster joined.
 *   1. A pin from lahman-fixes.json, else the one person with the exact birth date whose
 *      name agrees. Two such people: refuse to guess.
 *   2. Rows still open take the unique person with the same name letters (either name
 *      order) whose names agree, whose career overlaps the edition, who is not joined to a
 *      teammate, and whose birth date matches or differs by a known kind of error. A row
 *      without a birth date on a home-born team also needs the same birth country.
 */
export function matchRoster(rows: RosterRow[], people: PeopleIndex, fixes: LahmanFix[]): { matches: Map<string, Match | null>; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(rows.map((r) => r.id));
  for (const fix of fixes) {
    if (!ids.has(fix.id)) errors.push(`lahman-fixes: no record ${fix.id}`);
    if (fix.lahmanId && !people.peopleById.has(fix.lahmanId)) errors.push(`lahman-fixes: ${fix.id} pins unknown Lahman id ${fix.lahmanId}`);
    if (!/^https:\/\/\S+$/.test(fix.source)) errors.push(`lahman-fixes: ${fix.id} has no source URL`);
  }
  const pins = new Map(fixes.map((f) => [f.id, f.lahmanId]));

  const teams = new Map<string, TeamContext>();
  const teamOf = (p: ScrapedPlayer) => {
    const key = `${p.edition}-${p.country}`;
    return teams.get(key) ?? teams.set(key, { dobs: new Map(), joined: new Set() }).get(key)!;
  };
  const matches = new Map<string, Match | null>();

  for (const { id, player: p } of rows) {
    const team = teamOf(p);
    if (p.dob) team.dobs.set(p.dob, (team.dobs.get(p.dob) ?? 0) + 1);
    if (pins.has(id)) {
      const pinned = people.peopleById.get(pins.get(id) ?? '');
      matches.set(id, pinned ? { person: pinned, method: 'pinned' } : null);
    } else if (p.dob) {
      const fits = (people.peopleByDob.get(p.dob) ?? []).filter((person) => namesAgree(p.name, person, true));
      if (fits.length === 1) matches.set(id, { person: fits[0], method: 'dob+name' });
      else if (fits.length > 1) matches.set(id, null);
    }
    const joined = matches.get(id);
    if (joined) team.joined.add(joined.person.playerID);
  }

  for (const { id, player: p } of rows) {
    if (matches.has(id)) continue;
    const team = teamOf(p);
    const home = HOME_BIRTH_COUNTRY[p.country];
    const fits = (people.peopleByLetters.get(nameLetters(p.name)) ?? []).filter(
      (person) =>
        namesAgree(p.name, person, false) &&
        !team.joined.has(person.playerID) &&
        (person.debutYear ?? 0) <= p.edition + 1 &&
        (person.finalYear ?? 9999) >= p.edition - 25 &&
        birthDateExplained(p, person, team) &&
        (p.dob !== null || !home || person.birthCountry === home),
    );
    matches.set(id, fits.length === 1 ? { person: fits[0], method: 'name' } : null);
  }
  return { matches, errors };
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
  const rawOpsPlus = 100 * (obp / lg.obp + slg / lg.slg - 1);
  // Reliability shrinkage: a hot 140-PA stint shouldn't rate like a full elite
  // season, so deviations from league average shrink by PA/(PA+100).
  const reliability = s.PA / (s.PA + 100);
  return {
    year: s.year,
    opsPlus: 100 + (rawOpsPlus - 100) * reliability,
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
  const scored = inWindow.map((s) => scoreSeason(s, db)).filter((s): s is SeasonScore => s !== null);
  if (scored.length > 0) {
    // Blend the peak with the surrounding seasons so a single hot year doesn't
    // rate like sustained greatness (2006 Derrek Lee vs prime Pujols).
    const best = scored.reduce((a, b) => (b.opsPlus > a.opsPlus ? b : a));
    const others = scored.filter((s) => s !== best);
    const composite =
      others.length > 0
        ? 0.7 * best.opsPlus + 0.3 * (others.reduce((sum, s) => sum + s.opsPlus, 0) / others.length)
        : best.opsPlus;
    return { composite, contactScore: best.contactScore, powerScore: best.powerScore, speedScore: best.speedScore, method: 'mlb-window' };
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
// Pitching: approximate ERA+ blended with K-BB%, same windows/blends as hitters.

function scorePitchingSeason(s: SeasonPitching, db: Databank): number | null {
  const lg = db.leaguePitchingRates.get(`${s.year}-${s.lg}`);
  if (!lg || s.IPouts < 1 || s.BFP < 1) return null;
  const era = Math.max((s.ER * 27) / s.IPouts, 1.0); // floor so sub-1.00 relief ERAs don't explode the ratio
  const eraPlus = 100 * (lg.era / era);
  const kbbPlus = lg.kbbRate > 0 ? (100 * ((s.SO - s.BB) / s.BFP)) / lg.kbbRate : 100;
  const raw = 0.65 * eraPlus + 0.35 * kbbPlus;
  // 70 elite relief innings are real but not ace-season real: shrink hard by
  // innings, then discount relief deviations: rate stats in short stints
  // overstate value vs starters (a 99 should be Skenes, not a setup man).
  const reliability = s.IPouts / (s.IPouts + 250);
  const isRelief = s.GS < Math.max(3, 0.2 * s.G);
  const rolePenalty = isRelief ? 0.75 : 1;
  return 100 + (raw - 100) * reliability * rolePenalty;
}

export function bestMlbPitching(person: Person, edition: number, db: Databank): OffenseResult | null {
  const seasons = db.pitchingByPlayer.get(person.playerID) ?? [];
  const inWindow = seasons.filter((s) => Math.abs(s.year - edition) <= 1 && s.IPouts >= 90);
  const scored = inWindow
    .map((s) => ({ year: s.year, comp: scorePitchingSeason(s, db) }))
    .filter((s): s is { year: number; comp: number } => s.comp !== null);
  if (scored.length > 0) {
    const best = scored.reduce((a, b) => (b.comp > a.comp ? b : a));
    const others = scored.filter((s) => s !== best);
    const composite =
      others.length > 0 ? 0.7 * best.comp + 0.3 * (others.reduce((sum, s) => sum + s.comp, 0) / others.length) : best.comp;
    return { composite, contactScore: 0, powerScore: 0, speedScore: 0, method: 'mlb-window' };
  }
  const nearby = seasons
    .filter((s) => Math.abs(s.year - edition) <= 4 && s.IPouts >= 150)
    .sort((a, b) => Math.abs(a.year - edition) - Math.abs(b.year - edition));
  if (nearby.length > 0) {
    const comp = scorePitchingSeason(nearby[0], db);
    if (comp !== null) {
      const dist = Math.max(0, Math.abs(nearby[0].year - edition) - 1);
      return { composite: comp * (1 - 0.05 * dist), contactScore: 0, powerScore: 0, speedScore: 0, method: 'mlb-nearest' };
    }
  }
  return null;
}

/** SP/CL from real usage near the edition; RP accepts any pitcher (the DH of the mound). */
export function pitcherRoles(person: Person, edition: number, db: Databank): Position[] | null {
  const seasons = db.pitchingByPlayer.get(person.playerID) ?? [];
  for (const span of [1, 4]) {
    const win = seasons.filter((s) => Math.abs(s.year - edition) <= span);
    const G = win.reduce((sum, s) => sum + s.G, 0);
    const GS = win.reduce((sum, s) => sum + s.GS, 0);
    const SV = win.reduce((sum, s) => sum + s.SV, 0);
    if (G < 10) continue;
    const roles: Position[] = ['RP'];
    if (GS >= Math.max(8, 0.4 * G)) roles.unshift('SP');
    if (SV >= 8) roles.push('CL');
    return roles;
  }
  return null; // unknown usage: the caller grants full flexibility
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
  P: ['RP'], // pitchers get real roles in the build; this is only a fallback
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
    // Window then widen, but never the full career: a 2006 edition shouldn't
    // inherit positions a player only took up in MLB a decade later.
    const windows = [
      apps.filter((a) => Math.abs(a.year - p.edition) <= 1),
      apps.filter((a) => Math.abs(a.year - p.edition) <= 4),
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
  C: 68, SS: 70, CF: 68, '2B': 60, '3B': 58, RF: 52, LF: 50, '1B': 42, DH: 25, SP: 45, RP: 45, CL: 45,
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
// Anchored piecewise so the top compresses: 99 should be a couple dozen players, not a hundred.
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
