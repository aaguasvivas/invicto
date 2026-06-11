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

## Adding a language

The brand nouns (INVICTO, CAMPEÓN) stay untranslated in every language — they're the tier
names. Everything else localizes. To add Japanese, Korean, etc.:

1. Copy `src/i18n/es.json` to `src/i18n/ja.json` and translate it **natively** (the same bar as
   the Spanish: real baseball register, never machine-translated — including all 80 flavor
   lines).
2. Register it in `src/i18n/index.ts`:
   `{ code: 'ja', label: '日本語', table: ja, locale: 'ja' }`.

That's it — the title-screen switcher cycles through every registered language, browser
detection picks it up via `navigator.languages`, and dates format through the `locale` tag.

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
- `src/engine/teamRating.ts` — the soft-min gating exponent (`SOFTMIN_P`) and the calibration
  line (`CAL_A`, `CAL_B`).
- `src/engine/simulate.ts` — opponent tier strengths, knockout ratings (78/84/90), logistic
  scale, per-game noise.

The Monte Carlo test (`src/engine/montecarlo.test.ts`) pins the band: a top-percentile lineup
goes 7-0 about 2–5% of the time, a casual lineup's median finish is 4–6 wins, and one terrible
category caps the ceiling. Retune there if you touch any constant. Two diagnostic scripts print
where the calibration actually landed:

```sh
npx tsx scripts/calibration-report.ts   # synthetic lineups + global-best lineup
npx tsx scripts/draft-bot-report.ts     # 3000 real drafts (greedy bot), 7-0 rate by percentile
```
