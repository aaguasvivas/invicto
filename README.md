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

## Languages

Ships with Spanish (the source language), English, Japanese, and Korean. The brand nouns
(INVICTO, CAMPEÓN) stay untranslated everywhere — they're the tier names. To add another
language:

1. Copy `src/i18n/es.json` to `src/i18n/<code>.json` and translate it **natively** (the same
   bar as the Spanish: real baseball register, never machine-translated — including all 80
   flavor lines and the 23 country names).
2. Register it in `src/i18n/index.ts`:
   `{ code: 'xx', label: '<native name>', table: xx, locale: 'xx' }`.

The title-screen switcher cycles through every registered language, browser detection works via
`navigator.languages`, dates format through the `locale` tag, and `src/i18n/i18n.test.ts` fails
the build if any table drifts from the Spanish key tree, drops below 8 flavor variants per
outcome type, or misses a country name.

## Global daily stats (D1)

Anonymous daily aggregates ("you beat X% of today's managers", INVICTO counts, pick rarity)
served by two routes on the same Worker (`worker/index.ts`): `POST /api/result` and
`GET /api/today`. No accounts, no cookies, no IPs — a random client UUID dedupes resubmits.
The client fails silently if the API is unreachable; the game never depends on it.

One-time setup (needs Node ≥ 20 for wrangler):

```sh
npx wrangler login
npx wrangler d1 create invicto-stats          # note the database_id it prints
npx wrangler d1 execute invicto-stats --remote --file=worker/schema.sql
```

Then put the `database_id` into `wrangler.jsonc` (`d1_databases[0].database_id`, alongside
`"main": "worker/index.ts"` and the assets `run_worker_first` block mirroring
`wrangler.dev.jsonc`) and push.

Local development: `npx wrangler d1 execute invicto-stats --local --config wrangler.dev.jsonc
--file=worker/schema.sql`, then `npx wrangler dev --config wrangler.dev.jsonc` (port 8787 —
the Vite dev server proxies `/api` there).

## Monetization (ads, disabled by default)

`src/ui/ads.ts` holds a single tasteful AdSense integration: one responsive unit at the bottom
of the title screen and one below the result poster — never during the draft or the sim reveal.
It renders nothing (zero DOM, zero layout shift) until configured. To turn it on:

1. Sign up at adsense.google.com with `invictobaseball.com` and wait for site approval
   (typically a few days; the site needs to be live with traffic).
2. Create two ad units (AdSense → Ads → By ad unit → Display, responsive) named e.g.
   `invicto-title` and `invicto-result`.
3. Put your publisher id (`ca-pub-…`) into `ADSENSE_CLIENT` and the two slot ids into
   `AD_SLOTS` in `src/ui/ads.ts`, push, done.

Two honest notes: (a) for EEA/UK visitors Google requires a consent message — enable Google's
own CMP under AdSense → Privacy & messaging and it only appears for those regions; (b) revenue
scales with traffic (game-site RPMs are roughly $1–5 per thousand pageviews), so this is a
"when it's popular" lever, not a launch lever. A zero-compliance complement: a tip-jar link
("Invítame un cafecito ☕") in the footer.

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
