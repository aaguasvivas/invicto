// localStorage persistence: daily attempts, streak, personal bests, settings.
// Daily challenge number is days since launch (#1 = launch day), local time.
//
// All date math is calendar arithmetic on local day keys ("YYYY-MM-DD"), never
// "now minus 24 hours": DST days are 23 or 25 hours long, and a run that starts
// at 23:58 must still count for the day it was dealt.

import type { Outcome } from '../engine/types';

export type Mode = 'daily' | 'free' | 'hard';

export const DAILY_EPOCH = '2026-06-11'; // launch day = Reto del Día #1

export interface StoredResult {
  record: string;
  wins: number;
  losses: number;
  outcome: Outcome;
}

export function formatDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayKey(): string {
  return formatDayKey(new Date());
}

/** The calendar day before a day key (local, DST-safe). */
export function previousDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return formatDayKey(new Date(y, m - 1, d - 1));
}

/** Milliseconds until the next local midnight, i.e. the next daily challenge. */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function dailyNumber(dateKey = todayKey()): number {
  const ms = new Date(`${dateKey}T12:00:00`).getTime() - new Date(`${DAILY_EPOCH}T12:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function dailyResult(dateKey = todayKey()): StoredResult | null {
  return read<StoredResult>(`invicto.daily.${dateKey}`);
}

/**
 * Record the scored attempt for the day the run was dealt (not the day the
 * result screen happens to render). One scored attempt per day.
 */
export function saveDailyResult(result: StoredResult, day = todayKey()): void {
  if (dailyResult(day)) return;
  localStorage.setItem(`invicto.daily.${day}`, JSON.stringify(result));

  const last = localStorage.getItem('invicto.lastDaily');
  const streak = last === previousDayKey(day) ? currentStreak(day) + 1 : 1;
  localStorage.setItem('invicto.streak', String(streak));
  localStorage.setItem('invicto.lastDaily', day);
}

/** Streak as of a given day: alive if the last daily was that day or the day before. */
export function currentStreak(today = todayKey()): number {
  const last = localStorage.getItem('invicto.lastDaily');
  if (!last) return 0;
  if (last !== today && last !== previousDayKey(today)) return 0; // streak broken
  return Number(localStorage.getItem('invicto.streak') ?? '0');
}

const OUTCOME_RANK: Outcome[] = ['eliminated-pool', 'eliminated-qf', 'eliminated-sf', 'subcampeon', 'campeon', 'invicto'];

export function personalBest(mode: Mode): StoredResult | null {
  return read<StoredResult>(`invicto.best.${mode}`);
}

export function saveBest(mode: Mode, result: StoredResult): void {
  const prev = personalBest(mode);
  const better =
    !prev ||
    OUTCOME_RANK.indexOf(result.outcome) > OUTCOME_RANK.indexOf(prev.outcome) ||
    (result.outcome === prev.outcome && result.wins > prev.wins);
  if (better) localStorage.setItem(`invicto.best.${mode}`, JSON.stringify(result));
}

export function soundOn(): boolean {
  return localStorage.getItem('invicto.sound') === 'on';
}

export function setSound(on: boolean): void {
  localStorage.setItem('invicto.sound', on ? 'on' : 'off');
}
