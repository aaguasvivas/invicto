// Global daily stats: anonymous submission + "you beat X% today" math.
// The backend is two routes on the same Worker that serves the site (see
// worker/index.ts). Everything here fails silently: the game never depends
// on the network.

import * as storage from './storage';

export interface TodayStats {
  total: number;
  invictos: number;
  /** runs finished per win count today, e.g. { "4": 120, "7": 3 } */
  distribution: Record<string, number>;
  /** pick counts for the ids you submitted (POST only) */
  yourPicks?: { id: string; n: number }[];
}

/**
 * The fewest runs a day needs before the game shows any crowd number (a
 * percent, "Top X%", the day's counts). Below it, "You beat 50%" would mean
 * one other player.
 */
export const MIN_PUBLIC_SAMPLE = 25;

/** Today's runs in all, below a win count and level with it (yours included). */
function tally(wins: number, distribution: Record<string, number>): { total: number; below: number; equal: number } {
  const out = { total: 0, below: 0, equal: 0 };
  for (const [w, count] of Object.entries(distribution)) {
    out.total += count;
    if (Number(w) < wins) out.below += count;
    else if (Number(w) === wins) out.equal += count;
  }
  return out;
}

/**
 * Percent of today's other runs you beat: fewer wins count whole, the same
 * wins count half. Your own run is in the distribution and is taken out.
 * Null below the sample floor.
 */
export function percentileBeaten(wins: number, distribution: Record<string, number>): number | null {
  const { total, below, equal } = tally(wins, distribution);
  if (total < MIN_PUBLIC_SAMPLE) return null;
  const tiedOthers = Math.max(0, equal - 1);
  return Math.round(((below + tiedOthers / 2) / (total - 1)) * 100);
}

/**
 * The "Top X%" a share card may carry: the share of runs at or above yours,
 * floored at 1%. Null below the sample floor and above 50%, where the line
 * brags about nothing.
 */
export function topSharePct(wins: number, distribution: Record<string, number>): number | null {
  const { total, below } = tally(wins, distribution);
  if (total < MIN_PUBLIC_SAMPLE) return null;
  const pct = Math.max(1, Math.round(((total - below) / total) * 100));
  return pct <= 50 ? pct : null;
}

/** Your least-picked player today. Null below the sample floor. */
export function rarestPick(picks: { id: string; n: number }[], total: number): { id: string; pct: number } | null {
  if (total < MIN_PUBLIC_SAMPLE || picks.length === 0) return null;
  const rarest = picks.reduce((a, b) => (b.n < a.n ? b : a));
  return { id: rarest.id, pct: Math.max(1, Math.round((rarest.n / total) * 100)) };
}

// ---------------------------------------------------------------------------
// API client

let pageClientId: string | null = null;

/** Anonymous id that dedupes daily submissions. Kept on the device; when
    storage is unavailable it lasts for this page load only. */
export function clientId(): string {
  const stored = storage.get('invicto.clientId');
  if (stored) return stored;
  pageClientId ??=
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  storage.set('invicto.clientId', pageClientId);
  return pageClientId;
}

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, { ...init, signal: AbortSignal.timeout(6000) });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Submit a scored daily run; returns today's stats including your picks' rarity. Idempotent. */
export function submitResult(args: {
  day: string;
  wins: number;
  losses: number;
  outcome: string;
  picks: string[];
}): Promise<TodayStats | null> {
  return api<TodayStats>('/api/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...args, clientId: clientId() }),
  });
}

export function fetchToday(day: string): Promise<TodayStats | null> {
  return api<TodayStats>(`/api/today?day=${encodeURIComponent(day)}`);
}
