// A player's daily history, read back from the invicto.daily.YYYY-MM-DD keys.
// saveDailyResult has written one for every scored daily since launch, so a
// returning player's whole history is there with nothing to migrate. The
// streak is derived from those keys too: a day saved after the next one (a run
// finished in another tab after midnight) still joins the streak, which a
// stored counter could not do.

import type { Outcome } from '../engine/types';
import { dailyResult, OUTCOME_RANK, previousDayKey, todayKey, type StoredResult } from './state';
import * as storage from './storage';

export interface DailyEntry {
  day: string;
  result: StoredResult;
}

export interface DailyStats {
  played: number;
  /** CAMPEÓN and INVICTO runs */
  titles: number;
  invictos: number;
  /** consecutive days ending today, or yesterday while today is unplayed */
  streak: number;
  bestStreak: number;
  /** how many dailies ended each way */
  tiers: Record<Outcome, number>;
}

const DAY_KEY = /^invicto\.daily\.(\d{4}-\d{2}-\d{2})$/;

/** Every scored daily, oldest first. Empty when storage cannot be read. */
export function dailyEntries(): DailyEntry[] {
  const entries: DailyEntry[] = [];
  for (const key of storage.keys()) {
    const day = DAY_KEY.exec(key)?.[1];
    const result = day ? dailyResult(day) : null;
    // A value this version cannot read counts as no daily, never as a broken screen.
    if (day && result && OUTCOME_RANK.includes(result.outcome)) entries.push({ day, result });
  }
  return entries.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** The numbers of a history as of a day. Days after it (a clock set back) count as played but not toward its streak. */
export function dailyStats(entries: DailyEntry[], today: string): DailyStats {
  const tiers = Object.fromEntries(OUTCOME_RANK.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const { result } of entries) tiers[result.outcome]++;
  // The run of consecutive days that ends on each played day, built oldest first.
  const runEnding = new Map<string, number>();
  for (const day of entries.map((e) => e.day).sort()) runEnding.set(day, (runEnding.get(previousDayKey(day)) ?? 0) + 1);
  return {
    played: entries.length,
    titles: tiers.campeon + tiers.invicto,
    invictos: tiers.invicto,
    streak: runEnding.get(today) ?? runEnding.get(previousDayKey(today)) ?? 0,
    bestStreak: Math.max(0, ...runEnding.values()),
    tiers,
  };
}

/** The daily streak as of a day: alive while that day or the day before was played. */
export function currentStreak(today = todayKey()): number {
  return dailyStats(dailyEntries(), today).streak;
}
