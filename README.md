# Invicto ⚾

**¿Puedes quedar invicto?** / **Can you run the table?**

A free, mobile-first browser game: draft a full lineup in 12 rounds (9 hitters plus SP, RP and CL)
from random (country, edition) rolls across all six World Baseball Classic editions (2006 to 2026),
then sim the tournament. Win it all with a pool-play loss and you're **CAMPEÓN 🏆**. Go 7-0 and
you're **INVICTO ⭐**.

Live at [invictobaseball.com](https://invictobaseball.com) in Spanish, English, Japanese and Korean.

Not affiliated with, endorsed by, or sponsored by the World Baseball Classic, WBCI, MLB, NPB,
or any team or players' association. Player names and historical statistics are used as factual
references.

## Dev setup

```sh
npm install
npm run dev               # Vite dev server (proxies /api to wrangler dev on 8787)
npm test                  # vitest: engine, Monte Carlo band, i18n parity, badges, resume, poster layout
npm run build             # type-check app + worker, production build to dist/
npm run build:crazygames  # portal build (relative paths, no stats API) to dist-crazygames/
```

Stack: Vite + TypeScript, no framework, hand-written CSS. All game data is static JSON in
`public/data/`.

## Screens and local state

Title → draft → sim reveal → result poster (`src/main.ts` routes them). The title renders
before the roster JSON has loaded; the data is awaited only when a run starts, and a failed
load shows a retry card instead of a blank screen.

The result carries a scouting report (`src/game/scout.ts`, drawn by `src/ui/scoutCard.ts`): the
Team OVR, the six category bars with the weak spot, what ten more points there would buy, each
loss with its chance before the dice, best pick and weakest link against a median player at the
slot, and the title and 7-0 odds of that bracket. It reads the engine's own functions
(`categoryRatings`, `ratingFromCategories`, `winChance`) and draws nothing, so seeded runs never
change. From 960 px wide the result is two columns, with the report in a sticky right column.

The report ends with a draft grade against the scout (`scoutSearch` in `src/game/scout.ts`). The
scout drafts the run's 12 base rolls with no rerolls: a round-to-slot matching, then passes that
give a round a better player or let two rounds trade slots, from three fixed starts, with ties to
the lower player id. It draws nothing and reads no clock, so a seed always gets the same scout,
and its ranking uses products and one division (no `Math.pow`), so V8 and JavaScriptCore build
the same lineup. The result screen runs one pass per task after it paints and stops when you
leave. Your grade is the scout's Team OVR minus yours, in tenths: S at 0 or less, A to 1.5, B to
3, C to 5, D above. A scored daily keeps its grade, and the next day's title shows it.

Your numbers (`src/ui/screens/stats.ts`, opened from the 📊 chip, the day card and the result's
daily panel) shows dailies played, the current and best streak, the title rate, how each daily
ended, the Free play and Hard Mode bests, and all eight badges with the day each was earned.
`src/game/history.ts` reads all of it back from the day keys below, so a player who started
before the dialog existed sees their whole history, and a daily saved after the next day's
(a run finished in another tab after midnight) still counts toward the streak.

Every result can be shared as a challenge link (`src/game/challenge.ts`). The link's fragment
carries the run's seed, its 12 picks as indexes into the sorted player ids, the record it claims
and an optional nickname: `#r=<seed>.<fp><pattern><picks>[~nick]` (a full link is about 85
characters). A browser never sends a fragment to a server, and the game drops it from the
address bar on load. The friend's run replays the same seed, so it deals the same rolls and the
same dice; on one seed a higher Team OVR never does worse (pinned in `challenge.test.ts`), so
the draft alone decides the head-to-head. The title shows the challenge and never starts a run
by itself. Today's daily stays the real, scored daily; a past daily plays as practice; a deal
this device already played opens straight on the comparison, which saves, sends and earns
nothing. The result opens on a VS card (`src/ui/versus.ts`). Links made before a roster rebuild
still deal the same rolls, but compare records only.

Everything the game remembers lives in `localStorage`:

| Key | Holds |
| --- | --- |
| `invicto.lang`, `invicto.sound` | settings |
| `invicto.daily.<YYYY-MM-DD>` | the scored result for that day's Reto del Día (one per day); the daily history, the streak and the best streak in Your numbers are derived from these keys (`src/game/history.ts`, calendar-day math, DST-safe) |
| `invicto.best.<mode>` | personal best per mode |
| `invicto.badges` | earned badge ids with the date each was first earned (`src/game/badges.ts`) |
| `invicto.run` | autosave of an unfinished run, written after every pick and reroll; cleared when the run ends, and a daily snapshot expires with its day |
| `invicto.mine` | the last 30 finished runs (seed, player ids, day), so a challenge link to one of them opens on the comparison |
| `invicto.nick` | the optional nickname that signs challenge links |

Versions before Your numbers also kept `invicto.streak` and `invicto.lastDaily`. Nothing reads or
writes them now; they stay in older browsers' storage, ignored.

The resume snapshot stores player ids, not player objects, and is rebuilt against the current
data on load (`src/game/resume.ts`); a snapshot that no longer matches is dropped silently.

## Content pages

Beyond the game, `public/` holds crawlable static pages. How to play, FAQ, about, privacy,
terms and contact are bilingual: Spanish first, then the English half in
`<section lang="en" id="en">`, which English links open at `#en`. The roster reference pages
(`public/rosters/`: an index, one page per edition and one per country) and the articles have a
Spanish tree and an English mirror under `public/en/`. The in-game links pick the right tree for
the current language (Japanese and Korean fall back to English). Each Spanish and English pair
links the other with hreflang tags, and `sitemap.xml` lists every page.

The roster pages, the top-30 table of the two "best players" articles and `sitemap.xml` are
generated from `public/data/*.json` and the history paragraphs in
`data/curation/roster-editorial.json`. Edit the copy in `scripts/build-rosters.ts`, never the
HTML, and regenerate with `npm run build-rosters`. A test fails while the checked-in pages
differ from what the generator makes.

## Rebuilding the data

```sh
npm run build-data
npm run build-rosters   # regenerate the roster pages, article tables and sitemap from the new data
```

Wikipedia roster pages are fetched (and cached in `data-cache/wikipedia/`) automatically. The
Lahman/Chadwick databank CSVs must be present in `data-cache/databank/`: download the
comma-delimited version from https://sabr.org/lahman-database/ (files: `People.csv`,
`Batting.csv`, `Fielding.csv`, `Appearances.csv`, `Teams.csv`).

The build validates roster sizes, positions, duplicate IDs, and famous-player spot checks, then
prints a summary table and rating histogram. See [DATA.md](DATA.md) for the full methodology.

## Languages

Ships with Spanish (the source language), English, Japanese, and Korean. The brand nouns
(INVICTO, CAMPEÓN) stay untranslated everywhere; they are the tier names. To add another
language:

1. Copy `src/i18n/es.json` to `src/i18n/<code>.json` and translate it **natively** (the same
   bar as the Spanish: real baseball register, never machine-translated, including all 80
   flavor lines and the 23 country names).
2. Register it in `src/i18n/index.ts`:
   `{ code: 'xx', label: '<native name>', table: xx, locale: 'xx' }`.

The title-screen switcher cycles through every registered language (the other major language,
Spanish or English, is always the first tap), browser detection works via `navigator.languages`,
dates format through the `locale` tag, and `src/i18n/i18n.test.ts` fails the build if any table
drifts from the Spanish key tree, drops below 8 flavor variants per outcome type, or misses a
country name. No em dashes in any user-visible string, in any language.

## Global daily stats (D1)

Anonymous daily aggregates ("you beat X% of today's managers", INVICTO counts, pick rarity)
served by two routes on the same Worker (`worker/index.ts`): `POST /api/result` and
`GET /api/today`. No accounts, no cookies, no IPs; a random client UUID dedupes resubmits.
The client fails silently if the API is unreachable; the game never depends on it. The portal
build compiles these calls out entirely (`IS_PORTAL` in `src/portal.ts`). No crowd number
shows (a percent, "Top X%", the day's counts) until the day has 25 runs (`MIN_PUBLIC_SAMPLE` in
`src/game/stats.ts`). The percentile leaves your own run out and counts a tie as half, and a
share card carries "Top X%" only in the top half.

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
--file=worker/schema.sql`, then `npx wrangler dev --config wrangler.dev.jsonc` (port 8787; the
Vite dev server proxies `/api` there).

## Monetization

- **Tip jar (live):** a Ko-fi link on the title and result screens (`src/ui/tip.ts`). Hidden in
  the portal build.
- **AdSense (dormant):** `src/ui/ads.ts` holds one responsive unit at the bottom of the title
  screen and one below the result poster, never during the draft or the sim reveal. It renders
  nothing (zero DOM, zero layout shift) until `ADSENSE_CLIENT` and `AD_SLOTS` are filled in.
  Site approval is parked until the site has real traffic; for EEA/UK visitors Google's own CMP
  (AdSense → Privacy & messaging) covers the consent message.
- **CrazyGames (portal build):** `npm run build:crazygames` writes a self-contained
  `dist-crazygames/` with relative asset paths and the CrazyGames SDK wired through
  `src/portal.ts` (loading, gameplay start/stop, happytime, the player's CrazyGames language
  and the site's mute button). That bundle contains no site domain (share card and poster
  footer included), no AdSense path and no tip link, and the page turns off text selection.
  Challenge links there are CrazyGames invite links (`inviteLink({ r })`, read back with
  `getInviteParam('r')`); without them the result offers the poster image only.
  Upload the folder's contents unzipped.

## Deploying (Cloudflare Workers)

The site is a Worker (`worker/index.ts`, config in `wrangler.jsonc`) serving `dist/` as static
assets with clean URLs. Pushing to `main` deploys through Cloudflare Workers Builds; by hand:

```sh
npm run build
npx wrangler deploy
```

Confirm a deploy landed by comparing the bundle hash in `dist/index.html` with the one served at
https://invictobaseball.com (the edge cache can lag a minute; add `?cb=<anything>`).

## Tuning

The win-curve and rarity constants live in:

- `scripts/lib/ratings.ts`: rating anchors (`ANCHORS`, `REL_ANCHORS`), league multipliers,
  defense baselines.
- `src/engine/teamRating.ts`: the soft-min gating exponent (`SOFTMIN_P`) and the calibration
  line (`CAL_A`, `CAL_B`).
- `src/engine/simulate.ts`: opponent tier strengths, knockout ratings (78/84/90), logistic
  scale, per-game noise.

The Monte Carlo test (`src/engine/montecarlo.test.ts`) pins the band: a top-percentile lineup
goes 7-0 about 2 to 5% of the time, a casual lineup's median finish is 4 to 6 wins, and one
terrible category caps the ceiling. Retune there if you touch any constant. Seeded determinism
is a contract: new random draws go after the existing ones (or on a new `rngFor` path) so a
daily seed keeps dealing the same rolls. Two diagnostic scripts print where the calibration
actually landed:

```sh
npx tsx scripts/calibration-report.ts   # synthetic lineups + global-best lineup
npx tsx scripts/draft-bot-report.ts     # 3000 real drafts (greedy bot), 7-0 rate by percentile
```
