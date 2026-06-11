// Parses cached Wikipedia "<year> World Baseball Classic rosters" pages into raw player rows.
//
// Integrity rule: every row comes straight from the fetched page — nothing is invented
// or filled in from memory. If a page can't be parsed into plausible rosters, the build
// stops and reports it (see validate.ts).
//
// Page shape (all six editions): h2 "Pool A".. "Pool D" → h3 team name → roster table.
// Two table formats appear, sometimes both on the same page (2023):
//   A: Pos. | No. | Player | Date of birth (age) | Bats | Throws | Club
//   B: Player | No. | Pos. | DOB and age | Team | League | Birthplace
// Columns are resolved by header text, not position. Position cells use rowspan.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { resolveCountry } from './countries.js';

export const EDITIONS = [2006, 2009, 2013, 2017, 2023, 2026] as const;

export type PosGroup = 'P' | 'C' | 'IF' | 'OF' | 'UTL' | 'DH' | '1B' | '2B' | '3B' | 'SS';

export interface ScrapedPlayer {
  edition: number;
  country: string;
  pool: string;
  name: string;
  posRaw: string;
  /** Usually one group; compound listings like "SS/3B" (2026) yield several. */
  posGroups: PosGroup[];
  dob: string | null;
  club: string | null;
  leagueRaw: string | null;
  source: { url: string; retrievedAt: string };
}

export interface ParseWarning {
  edition: number;
  country: string | null;
  message: string;
}

const CACHE_DIR = 'data-cache/wikipedia';

export async function loadPage(year: number): Promise<{ html: string; url: string; retrievedAt: string }> {
  const url = `https://en.wikipedia.org/wiki/${year}_World_Baseball_Classic_rosters`;
  const file = `${CACHE_DIR}/${year}.html`;
  const metaFile = `${CACHE_DIR}/meta.json`;
  mkdirSync(CACHE_DIR, { recursive: true });
  const meta: Record<string, { url: string; retrievedAt: string }> = existsSync(metaFile)
    ? JSON.parse(readFileSync(metaFile, 'utf-8'))
    : {};
  if (!existsSync(file) || !meta[year]) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'InvictoDataBuild/0.1 (personal project; aaguasvivas907@gmail.com)' },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    writeFileSync(file, await res.text());
    meta[year] = { url, retrievedAt: new Date().toISOString() };
    writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  }
  return { html: readFileSync(file, 'utf-8'), url, retrievedAt: meta[year].retrievedAt };
}

const POS_MAP: Record<string, PosGroup> = {
  P: 'P', RHP: 'P', LHP: 'P', SP: 'P', RP: 'P',
  C: 'C',
  IF: 'IF', INF: 'IF',
  OF: 'OF', F: 'OF',
  U: 'UTL', UT: 'UTL', UTL: 'UTL',
  DH: 'DH',
  '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS',
};

/** Expand a table into a text grid, resolving rowspan/colspan. */
function tableToGrid($: cheerio.CheerioAPI, table: AnyNode): string[][] {
  const grid: string[][] = [];
  const pending = new Map<number, { remaining: number; text: string }>();
  $(table)
    .find('tr')
    .each((rowIdx, tr) => {
      const row: string[] = [];
      let col = 0;
      const place = (text: string) => {
        while (pending.has(col)) {
          const p = pending.get(col)!;
          row[col] = p.text;
          p.remaining -= 1;
          if (p.remaining === 0) pending.delete(col);
          col++;
        }
        row[col] = text;
        return col++;
      };
      $(tr)
        .children('th, td')
        .each((_, cell) => {
          const text = $(cell).text().trim();
          const at = place(text);
          const rowspan = parseInt($(cell).attr('rowspan') ?? '1', 10);
          const colspan = parseInt($(cell).attr('colspan') ?? '1', 10);
          if (rowspan > 1) pending.set(at, { remaining: rowspan - 1, text });
          for (let i = 1; i < colspan; i++) place(text);
        });
      // flush any trailing rowspans that extend past the last real cell
      while (pending.has(col)) {
        const p = pending.get(col)!;
        row[col] = p.text;
        p.remaining -= 1;
        if (p.remaining === 0) pending.delete(col);
        col++;
      }
      grid[rowIdx] = row;
    });
  return grid;
}

function cleanName(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, '') // footnote refs [1], [a]
    .replace(/\([^)]*\)/g, '') // CJK readings, "(c)" captain marks
    .replace(/[*†‡#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DOB_RE = /\((\d{4}-\d{2}-\d{2})\)/;

export function parseEdition(
  year: number,
  html: string,
  source: { url: string; retrievedAt: string },
): { players: ScrapedPlayer[]; teams: Map<string, string>; warnings: ParseWarning[] } {
  const $ = cheerio.load(html);
  const players: ScrapedPlayer[] = [];
  const teams = new Map<string, string>(); // country code → pool
  const warnings: ParseWarning[] = [];

  let pool: string | null = null;
  let country: string | null = null;

  $('h2, h3, table').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName;
    if (tag === 'h2') {
      const text = $(el).text().replace(/\[edit\]/g, '').trim();
      pool = /^Pool\s+[A-Z]/i.test(text) ? text.replace(/^Pool\s+/i, '') : null;
      country = null;
      return;
    }
    if (tag === 'h3') {
      if (!pool) return;
      const text = $(el).text().replace(/\[edit\]/g, '').trim();
      const c = resolveCountry(text);
      if (!c) {
        warnings.push({ edition: year, country: null, message: `Unrecognized team heading "${text}" in Pool ${pool}` });
        country = null;
        return;
      }
      country = c.code;
      teams.set(c.code, pool);
      return;
    }
    // table
    if (!pool || !country) return;
    const grid = tableToGrid($, el);
    if (grid.length < 2) return;
    const headers = grid[0].map((h) => h.toLowerCase());
    const idx = (re: RegExp) => headers.findIndex((h) => re.test(h));
    const playerIdx = idx(/player/);
    const posIdx = idx(/^pos/);
    if (playerIdx === -1 || posIdx === -1) return; // legend, coaches, statistics tables
    const dobIdx = idx(/date of birth|dob/);
    const clubIdx = idx(/club|^team$/);
    const leagueIdx = idx(/^league$/);

    for (const row of grid.slice(1)) {
      const rawName = row[playerIdx] ?? '';
      const name = cleanName(rawName);
      if (!name) continue;
      const posRaw = (row[posIdx] ?? '').trim();
      const posGroups = posRaw
        .split('/')
        .map((p) => POS_MAP[p.trim().toUpperCase()])
        .filter((p): p is PosGroup => Boolean(p));
      if (posGroups.length === 0) {
        warnings.push({ edition: year, country, message: `Unknown position "${posRaw}" for "${name}"` });
        continue;
      }
      const dobMatch = dobIdx >= 0 ? DOB_RE.exec(row[dobIdx] ?? '') : null;
      players.push({
        edition: year,
        country,
        pool,
        name,
        posRaw,
        posGroups,
        dob: dobMatch ? dobMatch[1] : null,
        club: clubIdx >= 0 ? (row[clubIdx] ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim() || null : null,
        leagueRaw: leagueIdx >= 0 ? (row[leagueIdx] ?? '').trim() || null : null,
        source,
      });
    }
  });

  return { players, teams, warnings };
}
