// Challenge links: every share is a dare a friend can answer. The link's
// fragment (#r=..., which a browser never sends to a server) carries a code:
//
//   <seed>.<fp><pattern><picks>[~nick]
//
//   seed     the run's seed, verbatim: free-..., hard-... or daily-YYYY-MM-DD
//   fp       2 base-36 characters: an FNV-1a hash of the sorted player ids, which
//            tells whether the picks still index the same rosters
//   pattern  2 base-36 characters: a leading 1, then one bit per game (1 = won),
//            so the record shows before the rosters have loaded
//   picks    12 x 2 base-62 characters: each an index into the sorted ids, in
//            SLOTS order (62 x 62 = 3,844 ids fit)
//   nick     optional, percent-encoded, 12 characters at most
//
// The friend's game replays the same seed: the same rolls and the same dice.
// On the same dice a stronger team never does worse (challenge.test.ts pins
// it), so the draft alone decides the head-to-head. Nothing here draws a
// random number: the seeded streams are untouched.

import { isEligible, SLOTS } from '../engine/positions';
import { simulateRun } from '../engine/simulate';
import type { EnginePlayer, GameResult, LineupSlots, RunResult } from '../engine/types';
import { DAILY_EPOCH, formatDayKey, todayKey, type Mode } from './state';
import * as storage from './storage';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SEED = /^(?:(?:free|hard)-[0-9a-z]{1,11}-[0-9a-z]{1,11}|daily-\d{4}-\d{2}-\d{2})$/;
const PAYLOAD = /^([0-9a-z]{2})([0-9a-z]{2})([0-9A-Za-z]{24})$/;
/** C0 and C1 controls, and the marks that reorder text (embeddings, overrides, isolates). */
const UNSAFE = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu;
export const NICK_MAX = 12;

/** A code as read from a link, before the rosters are needed. */
export interface ChallengeCode {
  /** the code as it travelled (the part after #r=) */
  raw: string;
  seed: string;
  fp: string;
  /** the claimed run, game by game */
  wins: boolean[];
  /** 12 indexes into the sorted player ids, in SLOTS order */
  picks: number[];
  nick: string | null;
}

/** The friend who sent the link, as far as this device can trust it. */
export interface Rival {
  code: string;
  name: string | null;
  seed: string;
  /** the claimed run, game by game */
  wins: boolean[];
  /** The rival's lineup and its replay; null when only the claimed record is kept (other rosters, or a replay that differs). */
  lineup: LineupSlots | null;
  run: RunResult | null;
}

// --- the code ---------------------------------------------------------------

interface RosterIndex {
  ids: string[];
  at: Map<string, number>;
  byId: Map<string, EnginePlayer>;
  fp: string;
}

const indexes = new WeakMap<EnginePlayer[], RosterIndex>();

/** Sorted by UTF-16 code units, never by locale, so every browser numbers the ids alike. */
function rosterIndex(players: EnginePlayer[]): RosterIndex {
  let index = indexes.get(players);
  if (!index) {
    const ids = players.map((p) => p.id).sort();
    index = { ids, at: new Map(ids.map((id, i) => [id, i])), byId: new Map(players.map((p) => [p.id, p])), fp: fingerprint(ids) };
    indexes.set(players, index);
  }
  return index;
}

/** FNV-1a over the sorted ids, folded into two base-36 characters. */
function fingerprint(ids: string[]): string {
  const text = ids.join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return ((hash >>> 0) % 1296).toString(36).padStart(2, '0');
}

const encodePattern = (wins: boolean[]): string => wins.reduce((n, win) => n * 2 + Number(win), 1).toString(36).padStart(2, '0');

function decodePattern(chars: string): boolean[] | null {
  const n = parseInt(chars, 36);
  if (n < 0b10000 || n > 0b11111111) return null; // 4 to 7 games
  const wins = [...n.toString(2).slice(1)].map((bit) => bit === '1');
  return playable(wins) ? wins : null;
}

/** Could a tournament end this way? Four pool games (three wins go through), then knockouts until a loss or the final. */
function playable(wins: boolean[]): boolean {
  if (wins.slice(0, 4).filter(Boolean).length < 3) return wins.length === 4;
  const knockouts = wins.slice(4);
  return knockouts.length > 0 && knockouts.slice(0, -1).every(Boolean) && (wins.length === 7 || !knockouts.at(-1));
}

export function seedMode(seed: string): Mode {
  return seed.slice(0, seed.indexOf('-')) as Mode;
}

/** The day a daily seed deals; null for free and hard seeds. */
export function seedDay(seed: string): string | null {
  return seed.startsWith('daily-') ? seed.slice(6) : null;
}

/** A seed the game deals: free and hard as made in session.ts, or a real daily from the first one to today. */
function validSeed(seed: string, today: string): boolean {
  if (!SEED.test(seed)) return false;
  const day = seedDay(seed);
  if (day === null) return true;
  const [y, m, d] = day.split('-').map(Number);
  return formatDayKey(new Date(y, m - 1, d)) === day && day >= DAILY_EPOCH && day <= today;
}

/** A nickname as shown: no control or reordering marks, one space between words, 12 characters at most. */
export function cleanNick(nick: string): string {
  const clean = nick.replace(/\s+/g, ' ').replace(UNSAFE, '').trim();
  return Array.from(clean).slice(0, NICK_MAX).join('').trim();
}

export function encodeChallenge(seed: string, lineup: LineupSlots, run: RunResult, players: EnginePlayer[], nick?: string | null): string {
  const index = rosterIndex(players);
  const picks = SLOTS.map((slot) => {
    const i = index.at.get(lineup[slot]?.id ?? '');
    if (i === undefined || i >= 62 * 62) throw new Error(`no index for the ${slot} pick`);
    return B62[Math.floor(i / 62)] + B62[i % 62];
  });
  const name = cleanNick(nick ?? '');
  return `${seed}.${index.fp}${encodePattern(run.games.map((g) => g.win))}${picks.join('')}${name ? `~${encodeURIComponent(name)}` : ''}`;
}

/** Read a code without the rosters; null for anything the game would not have made, or a daily still to come. */
export function parseChallenge(raw: string, today = todayKey()): ChallengeCode | null {
  const cut = raw.indexOf('~');
  const body = cut < 0 ? raw : raw.slice(0, cut);
  const dot = body.indexOf('.');
  if (dot < 0) return null;
  const seed = body.slice(0, dot);
  const payload = PAYLOAD.exec(body.slice(dot + 1));
  const wins = payload && decodePattern(payload[2]);
  if (!payload || !wins || !validSeed(seed, today)) return null;
  const picks = payload[3].match(/../g)!.map((pair) => B62.indexOf(pair[0]) * 62 + B62.indexOf(pair[1]));
  return { raw, seed, fp: payload[1], wins, picks, nick: cut < 0 ? null : decodeNick(raw.slice(cut + 1)) };
}

function decodeNick(encoded: string): string | null {
  let nick = encoded;
  try {
    nick = decodeURIComponent(encoded);
  } catch {
    // some apps hand the fragment over already decoded: keep it as typed
  }
  return cleanNick(nick) || null;
}

/**
 * Check a code against the rosters. Null when the picks cannot be a real
 * lineup (an unknown id, a slot he cannot play, the same man twice). When the
 * rosters changed since the link was made, or the replay does not reproduce
 * the claimed run, only the claimed record is kept.
 */
export function resolveChallenge(code: ChallengeCode, players: EnginePlayer[]): Rival | null {
  const index = rosterIndex(players);
  const rival: Rival = { code: code.raw, name: code.nick, seed: code.seed, wins: code.wins, lineup: null, run: null };
  if (code.fp !== index.fp) return rival;
  const lineup: LineupSlots = {};
  const persons = new Set<string>();
  for (const [i, slot] of SLOTS.entries()) {
    const player = index.byId.get(index.ids[code.picks[i]]);
    if (!player || !isEligible(player.positions, slot) || persons.has(player.personKey)) return null;
    lineup[slot] = player;
    persons.add(player.personKey);
  }
  const run = simulateRun(lineup, code.seed);
  const replayed = run.games.length === code.wins.length && run.games.every((g, i) => g.win === code.wins[i]);
  return replayed ? { ...rival, lineup, run } : rival;
}

export function rivalFrom(raw: string, players: EnginePlayer[], today = todayKey()): Rival | null {
  const code = parseChallenge(raw, today);
  return code && resolveChallenge(code, players);
}

export function recordOf(wins: boolean[]): string {
  const won = wins.filter(Boolean).length;
  return `${won}-${wins.length - won}`;
}

// --- where a link leads ----------------------------------------------------

/**
 * What Accept does. A deal this device already played goes straight to the
 * comparison. Today's daily is the real, scored daily (practice once it is
 * played); a past daily plays as practice; free and hard deal the same run.
 */
export type ChallengeKind = 'free' | 'hard' | 'daily' | 'dailyPlayed' | 'past' | 'compare';

export function challengeKind(seed: string, today: string, playedToday: boolean, mine: boolean): ChallengeKind {
  if (mine) return 'compare';
  const day = seedDay(seed);
  if (day === null) return seedMode(seed) === 'hard' ? 'hard' : 'free';
  if (day < today) return 'past';
  return playedToday ? 'dailyPlayed' : 'daily';
}

// --- the head-to-head --------------------------------------------------------

export type HeadToHead = 'won' | 'lost' | 'tie';

const runDifferential = (games: GameResult[]): number => games.reduce((sum, g) => sum + g.teamScore - g.oppScore, 0);

/**
 * Wins first, then run differential. On one seed the same record means the
 * same games won, so only the margins can split two runs; a rival known by
 * the record alone is judged on wins.
 */
export function versus(you: RunResult, rival: Rival): { result: HeadToHead; tiebreak: { us: number; them: number } | null } {
  const theirs = rival.wins.filter(Boolean).length;
  if (you.wins !== theirs) return { result: you.wins > theirs ? 'won' : 'lost', tiebreak: null };
  if (!rival.run) return { result: 'tie', tiebreak: null };
  const us = runDifferential(you.games);
  const them = runDifferential(rival.run.games);
  if (us === them) return { result: 'tie', tiebreak: null };
  return { result: us > them ? 'won' : 'lost', tiebreak: { us, them } };
}

/** Slots where both drafted the same player. */
export function matchedPicks(a: LineupSlots, b: LineupSlots): number {
  return SLOTS.filter((slot) => a[slot] !== undefined && a[slot]?.id === b[slot]?.id).length;
}

// --- this device's runs and nickname (best-effort, like all persistence) ------

/** A finished run: enough to replay it for a comparison. */
export interface MyRun {
  seed: string;
  /** player ids in SLOTS order */
  ids: string[];
  day: string;
}

const MINE = 'invicto.mine';
const MINE_CAP = 30;
const NICK = 'invicto.nick';

function isMyRun(x: unknown): x is MyRun {
  const run = x as MyRun;
  return typeof run?.seed === 'string' && typeof run.day === 'string' && Array.isArray(run.ids) && run.ids.length === SLOTS.length;
}

function myRuns(): MyRun[] {
  try {
    const list: unknown = JSON.parse(storage.get(MINE) ?? '[]');
    return Array.isArray(list) ? list.filter(isMyRun) : [];
  } catch {
    return [];
  }
}

/**
 * Keep a finished run for later comparisons, the last 30 seeds. The first run
 * of a seed is the one kept: for a daily, that is the scored attempt.
 */
export function rememberRun(seed: string, lineup: LineupSlots, day: string): void {
  const runs = myRuns();
  if (runs.some((run) => run.seed === seed)) return;
  runs.push({ seed, ids: SLOTS.map((slot) => lineup[slot]?.id ?? ''), day });
  storage.set(MINE, JSON.stringify(runs.slice(-MINE_CAP)));
}

export function ownRun(seed: string): MyRun | null {
  return myRuns().find((run) => run.seed === seed) ?? null;
}

/** The link is this device's own run: the same seed and the same 12 picks. */
export function isOwnChallenge(rival: Rival, own: MyRun | null): boolean {
  return own !== null && rival.lineup !== null && SLOTS.every((slot, i) => rival.lineup?.[slot]?.id === own.ids[i]);
}

export function savedNick(): string {
  return cleanNick(storage.get(NICK) ?? '');
}

export function saveNick(nick: string): void {
  const clean = cleanNick(nick);
  if (clean) storage.set(NICK, clean);
  else storage.remove(NICK);
}
