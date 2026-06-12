// Global daily stats: anonymous submission + "you beat X% today" math.
// The backend is two routes on the same Worker that serves the site (see
// worker/index.ts). Everything here fails silently — the game never depends
// on the network.

export interface TodayStats {
  total: number;
  invictos: number;
  /** runs finished per win count today, e.g. { "4": 120, "7": 3 } */
  distribution: Record<string, number>;
  /** pick counts for the ids you submitted (POST only) */
  yourPicks?: { id: string; n: number }[];
}

/** Percent of today's other runs you beat (strictly fewer wins). Null until ≥2 runs. */
export function percentileBeaten(wins: number, distribution: Record<string, number>): number | null {
  let total = 0;
  let below = 0;
  for (const [w, count] of Object.entries(distribution)) {
    total += count;
    if (Number(w) < wins) below += count;
  }
  if (total < 2) return null;
  return Math.round((below / total) * 100);
}

/** "Top X%": share of runs at-or-above yours, floored at 1%. */
export function topSharePct(wins: number, distribution: Record<string, number>): number {
  let total = 0;
  let atOrAbove = 0;
  for (const [w, count] of Object.entries(distribution)) {
    total += count;
    if (Number(w) >= wins) atOrAbove += count;
  }
  if (total < 1) return 100;
  return Math.max(1, Math.round((atOrAbove / total) * 100));
}

/** Your least-picked player today. Null until the day has a real sample. */
export function rarestPick(picks: { id: string; n: number }[], total: number): { id: string; pct: number } | null {
  if (total < 10 || picks.length === 0) return null;
  const rarest = picks.reduce((a, b) => (b.n < a.n ? b : a));
  return { id: rarest.id, pct: Math.max(1, Math.round((rarest.n / total) * 100)) };
}

// ---------------------------------------------------------------------------
// API client

function clientId(): string {
  let id = localStorage.getItem('invicto.clientId');
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('invicto.clientId', id);
  }
  return id;
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
