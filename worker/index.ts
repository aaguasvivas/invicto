// Invicto Worker: serves the static site and two anonymous stats routes.
//
//   POST /api/result  { day, clientId, wins, losses, outcome, picks[] }
//                     → today's stats + pick counts for your lineup (idempotent)
//   GET  /api/today?day=YYYY-MM-DD
//                     → today's stats
//
// Privacy: no IPs, no fingerprints — clientId is a random UUID the browser
// generated for itself, used only to keep refresh-resubmits from double counting.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const OUTCOMES = new Set(['invicto', 'campeon', 'subcampeon', 'eliminated-sf', 'eliminated-qf', 'eliminated-pool']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9]{4}-[a-z]{3}-[a-z0-9-]{1,80}$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Client-local "day" must sit within ±36h of server time (covers all timezones). */
function dayIsCurrent(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const ms = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) <= 36 * 3600 * 1000;
}

async function todayStats(db: D1Database, day: string, pickIds?: string[]) {
  const rows = await db.prepare('SELECT wins, COUNT(*) AS c FROM results WHERE day = ? GROUP BY wins').bind(day).all<{ wins: number; c: number }>();
  const distribution: Record<string, number> = {};
  let total = 0;
  for (const r of rows.results) {
    distribution[String(r.wins)] = r.c;
    total += r.c;
  }
  const inv = await db.prepare("SELECT COUNT(*) AS c FROM results WHERE day = ? AND outcome = 'invicto'").bind(day).first<{ c: number }>();
  const out: { total: number; invictos: number; distribution: Record<string, number>; yourPicks?: { id: string; n: number }[] } = {
    total,
    invictos: inv?.c ?? 0,
    distribution,
  };
  if (pickIds && pickIds.length > 0) {
    const marks = pickIds.map(() => '?').join(',');
    const picks = await db
      .prepare(`SELECT player_id, n FROM picks WHERE day = ? AND player_id IN (${marks})`)
      .bind(day, ...pickIds)
      .all<{ player_id: string; n: number }>();
    out.yourPicks = picks.results.map((p) => ({ id: p.player_id, n: p.n }));
  }
  return out;
}

async function handleSubmit(req: Request, env: Env): Promise<Response> {
  let body: { day?: string; clientId?: string; wins?: number; losses?: number; outcome?: string; picks?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const { day, clientId, wins, losses, outcome, picks } = body;
  if (
    typeof day !== 'string' || !dayIsCurrent(day) ||
    typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 64 ||
    typeof wins !== 'number' || !Number.isInteger(wins) || wins < 0 || wins > 7 ||
    typeof losses !== 'number' || !Number.isInteger(losses) || losses < 0 || losses > 4 ||
    wins + losses < 4 || wins + losses > 7 ||
    typeof outcome !== 'string' || !OUTCOMES.has(outcome) ||
    !Array.isArray(picks) || picks.length !== 12 || !picks.every((p) => typeof p === 'string' && ID_RE.test(p))
  ) {
    return json({ error: 'bad request' }, 400);
  }

  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO results (day, client_id, wins, losses, outcome) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(day, clientId, wins, losses, outcome)
    .run();

  if (inserted.meta.changes > 0) {
    // First submission from this client today: count the picks.
    const upsert = env.DB.prepare(
      'INSERT INTO picks (day, player_id, n) VALUES (?, ?, 1) ON CONFLICT(day, player_id) DO UPDATE SET n = n + 1',
    );
    await env.DB.batch(picks.map((p) => upsert.bind(day, p)));
  }

  return json(await todayStats(env.DB, day, picks));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/result' && request.method === 'POST') {
      return handleSubmit(request, env);
    }
    if (url.pathname === '/api/today' && request.method === 'GET') {
      const day = url.searchParams.get('day') ?? '';
      if (!dayIsCurrent(day)) return json({ error: 'bad day' }, 400);
      return json(await todayStats(env.DB, day));
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
