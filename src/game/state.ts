// localStorage persistence: daily attempts, streak, personal bests, settings.
// Daily challenge number is days since launch (#1 = launch day), local time.

import type { Outcome } from '../engine/types';

export type Mode = 'daily' | 'free' | 'hard';

export const DAILY_EPOCH = '2026-06-11'; // launch day = Reto del Día #1

export interface StoredResult {
  record: string;
  wins: number;
  losses: number;
  outcome: Outcome;
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export function saveDailyResult(result: StoredResult): void {
  const today = todayKey();
  if (dailyResult(today)) return; // one scored attempt per day
  localStorage.setItem(`invicto.daily.${today}`, JSON.stringify(result));

  const last = localStorage.getItem('invicto.lastDaily');
  const yesterday = new Date(Date.now() - 86400000);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const streak = last === yKey ? currentStreak() + 1 : 1;
  localStorage.setItem('invicto.streak', String(streak));
  localStorage.setItem('invicto.lastDaily', today);
}

export function currentStreak(): number {
  const last = localStorage.getItem('invicto.lastDaily');
  if (!last) return 0;
  const today = todayKey();
  const yesterday = new Date(Date.now() - 86400000);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (last !== today && last !== yKey) return 0; // streak broken
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
