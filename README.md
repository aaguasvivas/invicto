# Invicto ⚾

**¿Puedes quedar invicto?** / **Can you run the table?**

A free, mobile-first browser game: draft a 9-man lineup from random (country, edition) rolls
across all six World Baseball Classic editions (2006–2026), then sim the tournament. Win it all
with a pool-play loss and you're **CAMPEÓN 🏆**. Go 7-0 and you're **INVICTO ⭐**.

Not affiliated with, endorsed by, or sponsored by the World Baseball Classic, WBCI, MLB, NPB,
or any team or players' association. Player names and historical statistics are used as factual
references.

## Dev setup

```sh
npm install
npm run dev        # Vite dev server
npm test           # engine unit tests (vitest)
npm run build      # type-check + production build to dist/
```

Stack: Vite + TypeScript, no framework, hand-written CSS. All game data is static JSON in
`public/data/`.

## Rebuilding the data

```sh
npm run build-data
```

Wikipedia roster pages are fetched (and cached in `data-cache/wikipedia/`) automatically. The
Lahman/Chadwick databank CSVs must be present in `data-cache/databank/` — download the
comma-delimited version from https://sabr.org/lahman-database/ (files: `People.csv`,
`Batting.csv`, `Fielding.csv`, `Appearances.csv`, `Teams.csv`).

The build validates roster sizes, positions, duplicate IDs, and famous-player spot checks, then
prints a summary table and rating histogram. See [DATA.md](DATA.md) for the full methodology.

## Deploying (Cloudflare Pages)

Static output, no server:

```sh
npm run build
npx wrangler pages deploy dist
```

(Or point a Cloudflare Pages project at this repo: build command `npm run build`, output `dist`.
Vercel works identically.)

## Tuning

The win-curve and rarity constants live in:

- `scripts/lib/ratings.ts` — rating anchors (`ANCHORS`, `REL_ANCHORS`), league multipliers,
  defense baselines.
- `src/engine/` (Phase 2) — opponent strengths per round, the soft-min category gating, and the
  logistic win-probability curve. The Monte Carlo test asserts a top-percentile lineup goes 7-0
  about 2–5% of the time; retune there if you touch any of this.
