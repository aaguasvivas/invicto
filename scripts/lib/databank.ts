// Loads the SABR Lahman Database CSVs (1871–2025) from data-cache/databank/ and
// builds the indexes the ratings pass needs. See DATA.md for source details.

import { existsSync, readFileSync } from 'node:fs';

const DIR = 'data-cache/databank';
export const DATABANK_SOURCE =
  'SABR Lahman Baseball Database, 1871–2025 comma-delimited version (https://sabr.org/lahman-database/)';

/** Minimal CSV parser: handles quoted fields and strips BOM. The Lahman files have no embedded newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ''));
    return row;
  });
}

function load(name: string): Record<string, string>[] {
  const path = `${DIR}/${name}.csv`;
  if (!existsSync(path)) {
    throw new Error(
      `${path} not found. Download the comma-delimited Lahman database from https://sabr.org/lahman-database/ into ${DIR}/`,
    );
  }
  return parseCsv(readFileSync(path, 'utf-8'));
}

export interface Person {
  playerID: string;
  nameFirst: string;
  nameLast: string;
  birthDate: string | null; // YYYY-MM-DD
  birthYear: number | null;
  debutYear: number | null;
  finalYear: number | null;
}

export interface SeasonBatting {
  year: number;
  lg: string;
  PA: number;
  AB: number;
  H: number;
  D: number;
  T: number;
  HR: number;
  BB: number;
  HBP: number;
  SF: number;
  SO: number;
  SB: number;
  CS: number;
}

export interface LeagueRates {
  obp: number;
  slg: number;
  avg: number;
  kRate: number;
  iso: number;
}

export interface PositionGames {
  year: number;
  G_all: number;
  byPos: Record<string, number>; // C,1B,2B,3B,SS,LF,CF,RF,DH,P
}

export interface SeasonFielding {
  year: number;
  G: number;
  PO: number;
  A: number;
  E: number;
}

export interface SeasonPitching {
  year: number;
  lg: string;
  G: number;
  GS: number;
  SV: number;
  IPouts: number;
  ER: number;
  SO: number;
  BB: number;
  BFP: number;
}

export interface LeaguePitchingRates {
  era: number;
  kbbRate: number; // (SO − BB) / BFP
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Databank {
  peopleByDob: Map<string, Person[]>;
  peopleByName: Map<string, Person[]>;
  battingByPlayer: Map<string, SeasonBatting[]>;
  leagueRates: Map<string, LeagueRates>; // `${year}-${lg}`
  appearancesByPlayer: Map<string, PositionGames[]>;
  fieldingByPlayer: Map<string, SeasonFielding[]>;
  pitchingByPlayer: Map<string, SeasonPitching[]>;
  leaguePitchingRates: Map<string, LeaguePitchingRates>; // `${year}-${lg}`
  mlbClubNames: Set<string>; // normalized full franchise names, e.g. "chicago cubs"
}

const n = (v: string): number => (v === '' ? 0 : Number(v));

export function loadDatabank(): Databank {
  const people = load('People');
  const peopleByDob = new Map<string, Person[]>();
  const peopleByName = new Map<string, Person[]>();
  for (const r of people) {
    const by = r.birthYear ? Number(r.birthYear) : null;
    const person: Person = {
      playerID: r.playerID,
      nameFirst: r.nameFirst,
      nameLast: r.nameLast,
      birthDate:
        by && r.birthMonth && r.birthDay
          ? `${r.birthYear}-${r.birthMonth.padStart(2, '0')}-${r.birthDay.padStart(2, '0')}`
          : null,
      birthYear: by,
      debutYear: r.debut ? Number(r.debut.slice(0, 4)) : null,
      finalYear: r.finalGame ? Number(r.finalGame.slice(0, 4)) : null,
    };
    if (person.birthDate) {
      const arr = peopleByDob.get(person.birthDate) ?? [];
      arr.push(person);
      peopleByDob.set(person.birthDate, arr);
    }
    const full = normalizeName(`${r.nameFirst} ${r.nameLast}`);
    const arr = peopleByName.get(full) ?? [];
    arr.push(person);
    peopleByName.set(full, arr);
  }

  // Batting: aggregate stints per player-year; league rate sums per year+lg.
  const battingByPlayer = new Map<string, SeasonBatting[]>();
  const seasonKey = new Map<string, SeasonBatting>(); // playerID-year
  const lgSums = new Map<string, Record<string, number>>();
  for (const r of load('Batting')) {
    const year = Number(r.yearID);
    const key = `${r.playerID}-${year}`;
    let s = seasonKey.get(key);
    if (!s) {
      s = { year, lg: r.lgID, PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, BB: 0, HBP: 0, SF: 0, SO: 0, SB: 0, CS: 0 };
      seasonKey.set(key, s);
      const arr = battingByPlayer.get(r.playerID) ?? [];
      arr.push(s);
      battingByPlayer.set(r.playerID, arr);
    }
    const AB = n(r.AB), H = n(r.H), D = n(r['2B']), T = n(r['3B']), HR = n(r.HR);
    const BB = n(r.BB), HBP = n(r.HBP), SF = n(r.SF), SH = n(r.SH), SO = n(r.SO);
    s.AB += AB; s.H += H; s.D += D; s.T += T; s.HR += HR;
    s.BB += BB; s.HBP += HBP; s.SF += SF; s.SO += SO;
    s.SB += n(r.SB); s.CS += n(r.CS);
    s.PA += AB + BB + HBP + SF + SH;

    const lgKey = `${year}-${r.lgID}`;
    const sums = lgSums.get(lgKey) ?? { AB: 0, H: 0, D: 0, T: 0, HR: 0, BB: 0, HBP: 0, SF: 0, SO: 0, PA: 0 };
    sums.AB += AB; sums.H += H; sums.D += D; sums.T += T; sums.HR += HR;
    sums.BB += BB; sums.HBP += HBP; sums.SF += SF; sums.SO += SO;
    sums.PA += AB + BB + HBP + SF + SH;
    lgSums.set(lgKey, sums);
  }
  const leagueRates = new Map<string, LeagueRates>();
  for (const [key, s] of lgSums) {
    const obpDen = s.AB + s.BB + s.HBP + s.SF;
    if (s.AB < 1000 || obpDen < 1) continue;
    const tb = s.H + s.D + 2 * s.T + 3 * s.HR;
    leagueRates.set(key, {
      obp: (s.H + s.BB + s.HBP) / obpDen,
      slg: tb / s.AB,
      avg: s.H / s.AB,
      kRate: s.SO / s.PA,
      iso: tb / s.AB - s.H / s.AB,
    });
  }

  // Appearances: games by position per player-year (sum team stints).
  const appearancesByPlayer = new Map<string, PositionGames[]>();
  const appKey = new Map<string, PositionGames>();
  for (const r of load('Appearances')) {
    const year = Number(r.yearID);
    const key = `${r.playerID}-${year}`;
    let a = appKey.get(key);
    if (!a) {
      a = { year, G_all: 0, byPos: {} };
      appKey.set(key, a);
      const arr = appearancesByPlayer.get(r.playerID) ?? [];
      arr.push(a);
      appearancesByPlayer.set(r.playerID, arr);
    }
    a.G_all += n(r.G_all);
    const cols: [string, string][] = [
      ['C', 'G_c'], ['1B', 'G_1b'], ['2B', 'G_2b'], ['3B', 'G_3b'], ['SS', 'G_ss'],
      ['LF', 'G_lf'], ['CF', 'G_cf'], ['RF', 'G_rf'], ['DH', 'G_dh'], ['P', 'G_p'],
    ];
    for (const [pos, col] of cols) a.byPos[pos] = (a.byPos[pos] ?? 0) + n(r[col]);
  }

  // Fielding: totals per player-year (all positions combined — used only for a small quality adj).
  const fieldingByPlayer = new Map<string, SeasonFielding[]>();
  const fldKey = new Map<string, SeasonFielding>();
  for (const r of load('Fielding')) {
    if (r.POS === 'P') continue;
    const year = Number(r.yearID);
    const key = `${r.playerID}-${year}`;
    let f = fldKey.get(key);
    if (!f) {
      f = { year, G: 0, PO: 0, A: 0, E: 0 };
      fldKey.set(key, f);
      const arr = fieldingByPlayer.get(r.playerID) ?? [];
      arr.push(f);
      fieldingByPlayer.set(r.playerID, arr);
    }
    f.G += n(r.G); f.PO += n(r.PO); f.A += n(r.A); f.E += n(r.E);
  }

  // Pitching: aggregate stints per player-year; league ERA / K-BB rates per year+lg.
  const pitchingByPlayer = new Map<string, SeasonPitching[]>();
  const pitKey = new Map<string, SeasonPitching>();
  const lgPitSums = new Map<string, Record<string, number>>();
  for (const r of load('Pitching')) {
    const year = Number(r.yearID);
    const key = `${r.playerID}-${year}`;
    let s = pitKey.get(key);
    if (!s) {
      s = { year, lg: r.lgID, G: 0, GS: 0, SV: 0, IPouts: 0, ER: 0, SO: 0, BB: 0, BFP: 0 };
      pitKey.set(key, s);
      const arr = pitchingByPlayer.get(r.playerID) ?? [];
      arr.push(s);
      pitchingByPlayer.set(r.playerID, arr);
    }
    s.G += n(r.G); s.GS += n(r.GS); s.SV += n(r.SV);
    s.IPouts += n(r.IPouts); s.ER += n(r.ER); s.SO += n(r.SO); s.BB += n(r.BB); s.BFP += n(r.BFP);

    const lgKey = `${year}-${r.lgID}`;
    const sums = lgPitSums.get(lgKey) ?? { IPouts: 0, ER: 0, SO: 0, BB: 0, BFP: 0 };
    sums.IPouts += n(r.IPouts); sums.ER += n(r.ER); sums.SO += n(r.SO); sums.BB += n(r.BB); sums.BFP += n(r.BFP);
    lgPitSums.set(lgKey, sums);
  }
  const leaguePitchingRates = new Map<string, LeaguePitchingRates>();
  for (const [key, s] of lgPitSums) {
    if (s.IPouts < 3000 || s.BFP < 1000) continue;
    leaguePitchingRates.set(key, {
      era: (s.ER * 27) / s.IPouts,
      kbbRate: (s.SO - s.BB) / s.BFP,
    });
  }

  // MLB franchise names for classifying Club columns ("Chicago Cubs" → MLB) on pages without a League column.
  const mlbClubNames = new Set<string>();
  for (const r of load('Teams')) {
    if (Number(r.yearID) >= 1990 && r.name) mlbClubNames.add(normalizeName(r.name));
  }

  return { peopleByDob, peopleByName, battingByPlayer, leagueRates, appearancesByPlayer, fieldingByPlayer, pitchingByPlayer, leaguePitchingRates, mlbClubNames };
}
