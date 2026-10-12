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

**Pitchers** are fully rated and shipped — the draft has 12 slots: the 9 hitting positions plus
SP, RP, and CL.

**Two-way rule:** a pitcher-listed player with an MLB season of ≥ 200 PA within ±1 year of the
edition is treated as a hitter (this catches Ohtani in 2023 without any hardcoded names; NL
pitchers who batted never reached 200 PA). Two-way stars additionally carry their pitching
roles, so Ohtani can be drafted at DH *or* SP.

### Pitcher ratings

Same windows, blends, and anchors as hitters, on a pitching composite:

```
composite = 0.65 × ERA+approx + 0.35 × KBB+    (vs that season's league)
```

with an ERA floor of 1.00, **innings shrinkage** (`IPouts/(IPouts+250)` on the deviation), and
a **relief discount** (×0.75 on the deviation for seasons with GS < max(3, 20% of G)) — short
elite relief stints are real but a 99 should be Paul Skenes, not a setup man. Roles come from
real usage near the edition: SP if GS ≥ max(8, 40% of G), CL if SV ≥ 8; **RP accepts any
pitcher** (the DH of the mound). Unmatched foreign pitchers stay role-flexible. The curation
file covers foreign aces (Darvish 2009, Yamamoto 2023, Lazo 2006, Raidel Martínez …) under the
same citation rules.

In the team rating, pitching is a **sixth gated category** (mean rating of the three pitcher
slots, soft-min blended with the five hitting categories) — a punted staff caps the ceiling no
matter how scary the lineup.

## Matching roster names to Lahman IDs

1. **dob+name** — exact birth-date match, then name-token overlap (handles accents, "Kim
   Hyun-soo" vs "Hyun Soo Kim" ordering, hyphens). Ambiguity (two same-name, same-DOB people)
   is refused rather than guessed.
2. **name-unique** — normalized full-name match that is unique in the databank and whose career
   window plausibly overlaps the edition. Only used when DOB is unavailable on one side.
3. No match → heuristic path below.

## Ratings (1–99)

### MLB-matched players (`ratingMethod: "mlb-window"`)

Seasons with **PA ≥ 100 within ±1 calendar year of the edition** (for 2026, only seasons
through 2025 exist yet, which is still inside the window). Era adjustment comes free by
computing everything relative to that season's league (AL/NL totals from `Batting.csv`):

```
OPS+approx = 100 × (OBP/lgOBP + SLG/lgSLG − 1)
```

Two corrections keep "superstar" meaning superstar:

- **Reliability shrinkage** — each season's deviation from league average is scaled by
  `PA/(PA+100)`, so a hot 140-PA stint can't rate like a full elite season.
- **Peak blend** — the window composite is `0.7 × best season + 0.3 × mean(other window
  seasons)`. Sustained greats (Pujols, Cabrera, Trout, Judge, Ohtani) stay at the top; a single
  career year (2005 Derrek Lee, 2006 Morneau) lands a tier below.

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
club name: MLB franchise names from `Teams.csv`, "(farm)" suffix → minors, and a **club →
league map voted from every roster row that does have a League column** (the 2006/2009 pages
only list clubs, so "Yomiuri Giants" resolves to NPB through what later editions say about that
club). Unclassifiable → "everything else".

### Curated foreign stars (`ratingMethod: "curated"`)

The tier heuristic can't see that 2023 Murakami was coming off 56 HR. The fix is a hand-curated
tier file, `data/curation/foreign-stars.json` (~130 entries), under strict integrity rules:

- An entry can only **lift** a player who is already on a scraped roster — `(edition, exact
  roster name)` must match or the build fails. Curation can never invent a roster spot.
- Every entry cites a Wikipedia article. The build fetches each citation (cached) and fails on
  HTTP errors; it warns when the article doesn't mention the claimed league. (This caught two
  wrong-person redirects on the first run.)
- The applied composite is `max(computed, tierValue × league multiplier)` — it never lowers.
- Tiers: **S** = 150 (generational: 2023 Murakami, 2012 Abe, peak Yamada, 2006 Lee Seung-yeop,
  2026 Kim Do-yeong), **A+** = 135, **A** = 125, **B+** = 110. Where a player's accomplishments
  are thin or absent, they are deliberately *not* curated — absence of accomplishments is
  itself the signal, and the tier heuristic stands.

### Positional offense adjustment

The overall rating adds a positional adjustment to the composite (premium positions get bat
credit, like real positional adjustments): C +12, SS +7, CF +6, 2B/3B +4, corners 0, 1B −3,
DH −6, plus a small speed credit (`0.15 × (speed − 50)`). Defense remains a gated category in
the team-rating blend but no longer double-counts into the overall number.

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

## Identity: one personKey per real player

The draft refuses a player who is already on your team, and it checks `personKey` to decide.
Record ids stay fixed (`2009-pur-carlos-beltran`), because saved runs and the daily stats
table store them. The rating pass gives each record a provisional key `slug|dob`
(`carlos-beltran|1977-04-24`, or `carlos-beltran|?` when the roster page lists no birth date).
One player can hold several provisional keys: the 2006 Puerto Rico page has no birth dates,
Korean and Taiwanese names appear in both orders (Oh Seung-hwan, Seunghwan Oh), some birth
dates carry a typo or a teammate's date, and some players appear under a short name (Nori and
Norichika Aoki).

`scripts/lib/identity.ts` groups records into people with a union-find, in this order:

| Rule | Two records become one person when |
|---|---|
| R0 | they share a provisional key |
| R2 | the rating pass joined both to the same Lahman `playerID` |
| R3 | an alias group in `data/curation/person-aliases.json` lists both |
| R1 | they share the country and the sorted letters of the accent-folded name (spaces and hyphens removed), and their birth dates agree: equal, one of year, month and day different, or month and day swapped. A record without a birth date joins only when exactly one person fits and the age at that edition falls between 16 and 47. |

Guards apply to every merge. Two records of one team-edition stay apart, two different Lahman
ids stay apart, and a pair listed as `distinct` stays apart. R1 and R2 skip January 1 birth
dates, which the Cuban rosters use as a placeholder; only an alias merges them. Aliases skip
the birth-date checks and keep the other guards.

A person's `personKey` is the provisional key of their earliest record with a birth date, or of
their earliest record when none has one. A player who had a single key keeps it.

`person-aliases.json` holds the reviewed decisions, each with a note and a source URL (usually
the article that both roster rows link):

- `aliases`: 23 groups of one person under two spellings, a nickname, or a mistyped or copied
  birth date.
- `distinct`: 5 pairs with the same country and name letters that are two people, such as the
  pitcher Édgar González (2006) and the infielder Edgar Gonzalez (2009, 2013).
- `wrongLahmanJoins`: rating-pass joins that identity ignores. The 2013 Carlos González row
  carries Carlos Gómez's birth date, so the rating pass joins it to Gómez.

The build stops when a curated id matches no record, an entry lacks a source, an alias breaks a
guard, a `wrongLahmanJoins` entry no longer matches the rating pass, or two people share a
country and name letters without a `distinct` entry. It prints the merges per rule and warns
when one Lahman id joins records that cannot be one person (the Wells twins today).

Current data: 3,175 records, 2,524 provisional keys, **2,304 distinct players**. The build
merged 220 keys: 56 by Lahman id, 26 by alias, 138 by name letters. `src/game/data.test.ts`
checks the shipped file: no key repeats within a team-edition, no two keys share sorted name
letters and a birth date, no undated key shares slug and country with a dated key unless listed
as distinct, every alias group shares one key, and the count in this paragraph matches the file.

## Known limitations (v1)

- NPB/KBO/CPBL/Cuban stars without MLB careers rate as tier B regulars — their real stats
  aren't programmatically available in the databank.
- 2023 Israel and 2023 Venezuela have no CF-refined hitter; the draft engine must tolerate
  rosters with no eligible player for a specific open slot.
- "Eastern League" (ambiguous between MiLB AA and the NPB farm league) is classified as MiLB.
- No park factors; single-season basis means hot seasons (2005 Derrek Lee) rate at their peak.
