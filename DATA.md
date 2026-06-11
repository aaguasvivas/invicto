# Invicto — Data Methodology

Everything in `public/data/` is produced by `npm run build-data` (`scripts/build-data.ts`).
No player is ever invented, inferred, or filled in from memory: if a roster page can't be
parsed, the build stops and reports it.

## Sources

| What | Source | Notes |
|---|---|---|
| Rosters | Wikipedia "`<year>` World Baseball Classic rosters" pages (2006, 2009, 2013, 2017, 2023, 2026) | Fetched and cached in `data-cache/wikipedia/`; every player record carries `source: { url, retrievedAt }` |
| MLB stats | SABR Lahman Baseball Database, 1871–2025, comma-delimited version — https://sabr.org/lahman-database/ | This is the continuation of the Chadwick Bureau Baseball Databank; the `chadwickbureau/baseballdatabank` GitHub repo named in the original spec no longer exists, and SABR's distribution is the same database's official current home. Cached in `data-cache/databank/`. |

Both caches are gitignored; the build re-fetches Wikipedia pages if missing. The Lahman CSVs
must be downloaded into `data-cache/databank/` (the build prints the URL if they're absent).
Files used: `People.csv`, `Batting.csv`, `Fielding.csv`, `Appearances.csv`, `Teams.csv`.

## Parsing

Each roster page is walked in document order: `h2` "Pool A–D" → `h3` team heading → roster
tables. Tables are recognized by header signature (must contain *Player* and *Pos* columns) and
expanded with full rowspan/colspan resolution. Two formats appear, sometimes both on one page
(2023); columns are resolved by header text. Team headings are normalized ("Taiwan" → Chinese
Taipei, "South Korea" → South Korea, etc. — see `scripts/lib/countries.ts`).

Extracted per player: name (footnotes, captain marks, and CJK readings stripped), raw position,
date of birth (from the hidden `(YYYY-MM-DD)` sort key), club, and league where the page has a
League column (2013, 2017, 2026, half of 2023).

**Pitchers** are kept in `data/raw/scraped-players.json` with `excludedFromV1: true` and
rating 0 (v2 can rate them from `Pitching.csv` without re-scraping). They are not shipped in
`public/data/players.json`.

**Two-way rule:** a pitcher-listed player with an MLB season of ≥ 200 PA within ±1 year of the
edition is treated as a hitter (this catches Ohtani in 2023 without any hardcoded names; NL
pitchers who batted never reached 200 PA).

## Matching roster names to Lahman IDs

1. **dob+name** — exact birth-date match, then name-token overlap (handles accents, "Kim
   Hyun-soo" vs "Hyun Soo Kim" ordering, hyphens). Ambiguity (two same-name, same-DOB people)
   is refused rather than guessed.
2. **name-unique** — normalized full-name match that is unique in the databank and whose career
   window plausibly overlaps the edition. Only used when DOB is unavailable on one side.
3. No match → heuristic path below.

## Ratings (1–99)

### MLB-matched players (`ratingMethod: "mlb-window"`)

Best MLB season with **PA ≥ 100 within ±1 calendar year of the edition** (for 2026, only
seasons through 2025 exist yet, which is still inside the window). Era adjustment comes free by
computing everything relative to that season's league (AL/NL totals from `Batting.csv`):

```
OPS+approx = 100 × (OBP/lgOBP + SLG/lgSLG − 1)
```

No park adjustment (documented simplification). If a matched player has no qualifying season in
the window but has one with ≥ 200 PA within ±4 years, that season is used decayed by **5% per
year outside the window** (`ratingMethod: "mlb-nearest"`).

### Non-MLB players (`ratingMethod: "heuristic"`)

`composite = tier × leagueMultiplier`, where tier B (regular starter) = 100 OPS+-equivalent and
tier C (bench / outside prime) = 85. Tier is assigned by a transparent heuristic: **B if age at
the edition is 23–34, otherwise C**. Tier A (125) is reserved — foreign-league All-Star data
isn't programmatically available yet, so no heuristic player reaches it (this is why NPB/KBO
stars like 2023 Murakami rate as good-not-great; a curated upgrade pass is a candidate for v2).

League multipliers (the first four are from the spec; the last two are documented additions so
Cuban National Series players and affiliated minor leaguers aren't lumped with amateurs):

| League | Multiplier |
|---|---|
| MLB (matched but rated heuristically) | 1.00 |
| NPB | 0.92 |
| KBO | 0.85 |
| CPBL | 0.78 |
| Cuban National Series | 0.80 |
| Affiliated minors (MiLB, indy partner leagues) | 0.75 |
| Everything else (ABL, LMB, European, amateur…) | 0.70 |

League is read from the roster page's League column when present; otherwise classified from the
club name (MLB franchise names from `Teams.csv`; "(farm)" suffix → minors). Unclassifiable →
"everything else".

### Composite → rating curve

Fixed anchors (OPS+-equivalent → rating), linearly interpolated — **not** a percentile map, so
99 stays genuinely rare regardless of pool composition:

```
40→18  60→30  70→38  85→50  100→62  115→72  130→80  145→87  160→92  180→96  200→99
```

The overall rating uses `composite + 0.3×(defense−50) + 0.15×(speed−50)` so premium defenders
and runners get credit beyond their bat.

### Subratings

| Subrating | MLB-matched | Heuristic |
|---|---|---|
| `contact` | `AVG/lgAVG − 0.5×(K%/lgK% − 1)` through anchored curve | rating − 2 ± seeded noise |
| `power` | `ISO/lgISO` through anchored curve | rating − 8 ± seeded noise |
| `speed` | `(SB + 2×3B)/PA`, scaled (0.04 ≈ 62, 0.10+ ≈ 95) | position prior (CF/SS high, C/1B low) ± noise |
| `defense` | position baseline (C 68, SS 70, CF 68 … 1B 42, DH 25) ± fielding-pct adjustment vs .975, capped ±12 | baseline ± seeded noise |
| `clutch` | **flavor stat**: rating ± 5, seeded | same |

All randomness is seeded by player ID — rebuilds are deterministic.

### Position eligibility (`positions`)

For matched players, positions come from `Appearances.csv` games by position (window ±1 year,
widening to ±4 then career until ≥ 20 games of evidence): eligible where games ≥ max(10, 10% of
appearances). This is how "true CF" is distinguished from corner outfielders. Unmatched players
keep their roster grouping: `IF` → 1B/2B/3B/SS, `OF` → LF/CF/RF, `UTL`/`U` → everything but C
and CF, compound listings like "SS/3B" (2026 pages) → exactly those. DH eligibility is implicit
for every hitter in the engine.

## Validation (runs inside the build; failures stop it)

- Every team-edition between 25–32 players, 26–31 expected — outside values are printed for
  manual review (the 2017 and some 2023 teams legitimately carried designated-pitcher pools and
  land at 33–38).
- Every hitter has ≥ 1 position; ≥ 9 hitters per team; no duplicate IDs; ratings within 1–99.
- Spot checks: NED 2017 must contain Bogaerts, Simmons, Profar, Schoop; JPN 2023 must contain
  Ohtani **as a hitter**; VEN 2026 must contain Maikel García and Eugenio Suárez.
- Prints the edition × country summary table and the hitter rating histogram.

## Known limitations (v1)

- NPB/KBO/CPBL/Cuban stars without MLB careers rate as tier B regulars — their real stats
  aren't programmatically available in the databank.
- 2023 Israel and 2023 Venezuela have no CF-refined hitter; the draft engine must tolerate
  rosters with no eligible player for a specific open slot.
- "Eastern League" (ambiguous between MiLB AA and the NPB farm league) is classified as MiLB.
- No park factors; single-season basis means hot seasons (2005 Derrek Lee) rate at their peak.
