# Invicto data methodology

Everything in `public/data/` is produced by `npm run build-data` (`scripts/build-data.ts`).
No player is ever invented, inferred, or filled in from memory: if a roster page can't be
parsed, the build stops and reports it.

## Sources

| What | Source | Notes |
|---|---|---|
| Rosters | Wikipedia "`<year>` World Baseball Classic rosters" pages (2006, 2009, 2013, 2017, 2023, 2026) | Fetched and cached in `data-cache/wikipedia/`; every player record carries `source: { url, retrievedAt }` |
| MLB stats | SABR Lahman Baseball Database, 1871–2025, comma-delimited version: https://sabr.org/lahman-database/ | This is the continuation of the Chadwick Bureau Baseball Databank; the `chadwickbureau/baseballdatabank` GitHub repo named in the original spec no longer exists, and SABR's distribution is the same database's official current home. Cached in `data-cache/databank/`. |

Both caches are gitignored; the build re-fetches Wikipedia pages if missing. The Lahman CSVs
must be downloaded into `data-cache/databank/` (the build prints the URL if they're absent).
Files used: `People.csv`, `Batting.csv`, `Pitching.csv`, `Fielding.csv`, `Appearances.csv`, `Teams.csv`.

## Parsing

Each roster page is walked in document order: `h2` "Pool A–D" → `h3` team heading → roster
tables. Tables are recognized by header signature (must contain *Player* and *Pos* columns) and
expanded with full rowspan/colspan resolution. Two formats appear, sometimes both on one page
(2023); columns are resolved by header text. Team headings are normalized ("Taiwan" → Chinese
Taipei, "South Korea" → South Korea, and so on; see `scripts/lib/countries.ts`).

Extracted per player: name (footnotes, captain marks, and CJK readings stripped), raw position,
date of birth, club, and league where the page has a League column (2013, 2017, 2026, half of
2023). The birth date comes from the hidden `(YYYY-MM-DD)` sort key; when a cell has no sort key
(the 2006 Australia, Italy and South Africa tables and the 2009 Mexico table), it comes from the
visible "Month D, YYYY" text. 128 rows have no birth date on the page at all.

**Pitchers** are fully rated and shipped. The draft has 12 slots: the 9 hitting positions plus
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
a **relief discount** (×0.75 on the deviation for seasons with GS < max(3, 20% of G)): short
elite relief stints are real, but a 99 should be Paul Skenes, not a setup man. Roles come from
real usage near the edition: SP if GS ≥ max(8, 40% of G), CL if SV ≥ 8; **RP accepts any
pitcher** (the DH of the mound). Unmatched foreign pitchers stay role-flexible. The curation
file covers foreign aces (Darvish 2009, Yamamoto 2023, Lazo 2006, Raidel Martínez …) under the
same citation rules.

In the team rating, pitching is a **sixth gated category** (mean rating of the three pitcher
slots, soft-min blended with the five hitting categories), so a punted staff caps the ceiling no
matter how scary the lineup.

## Matching roster names to Lahman IDs

`matchRoster` in `scripts/lib/ratings.ts` joins every roster row to at most one Lahman person.
Names agree when the surname agrees (accents, hyphens, name order and "Jr." ignored; one letter
of slack from five letters up, so Villareal matches Villarreal) and the given name agrees: equal,
the same first three letters, or a known nickname (Mike and Michael). A shared given name alone
("Carlos" González and "Carlos" Gómez) or a shared surname alone (the twins Lachlan and Alex
Wells) is not enough.

1. **Pinned**: `data/curation/lahman-fixes.json` sets the join for a record id, or sets it to
   none. Each entry cites the article the roster row links and states the roster and Lahman
   birth dates and the Lahman team stints near the edition. It covers rows whose birth date
   differs in two or more fields (Odalis Pérez 2006, Erick Aybar 2013, Rubén Tejada 2009, Omar
   Narváez 2023, José Caballero 2026, Jhonathan Díaz 2026, Sam Fuld 2017), the 2013 Carlos
   González row that carries Carlos Gómez's birth date, and the 2006 Panama Ramón Ramírez, who
   is not the Dominican Ramón Ramírez in Lahman.
2. **dob+name**: the one person with the exact birth date whose name agrees (here the same
   first initial is enough). Two such people: refused rather than guessed.
3. **name**: rows still open take the unique person with the same name letters (either name
   order) whose name agrees, whose career overlaps the edition (debut no later than a year
   after it, final game no earlier than 25 years before it), and who is not already joined to a
   teammate in steps 1 and 2. The birth dates must agree or differ by a known kind of error:
   - one of year, month and day differs, or month and day are swapped (2009 Iván Rodríguez
     1971-11-30 for 1971-11-27; 2013 Hanley Ramírez 1983-12-22 for 1983-12-23);
   - the roster copied a teammate's birth date (2023 Jeff McNeil carries Miles Mikolas's
     1988-08-23);
   - the person's real birth date sits on a teammate's row (2023 Chadwick Tromp and Sicnarf
     Loopstok).

   A row without a birth date on a team whose players are born in the country (Panama,
   Dominican Republic, Venezuela, Cuba, Japan, South Korea, Chinese Taipei, Colombia,
   Nicaragua, China) also needs a Lahman `birthCountry` from that country.
4. No match: heuristic path below.

Current data: 1,405 dob+name joins, 88 name joins, 8 pinned joins, 1,674 rows unmatched. The
build fails when a pin names a record or Lahman id that does not exist, or has no source URL.

## Ratings (1–99)

### MLB-matched players (`ratingMethod: "mlb-window"`)

Seasons with **PA ≥ 100 within ±1 calendar year of the edition** (for 2026, only seasons
through 2025 exist yet, which is still inside the window). Era adjustment comes free by
computing everything relative to that season's league (AL/NL totals from `Batting.csv`):

```
OPS+approx = 100 × (OBP/lgOBP + SLG/lgSLG − 1)
```

Two corrections keep "superstar" meaning superstar:

- **Reliability shrinkage**: each season's deviation from league average is scaled by
  `PA/(PA+100)`, so a hot 140-PA stint can't rate like a full elite season.
- **Peak blend**: the window composite is `0.7 × best season + 0.3 × mean(other window
  seasons)`. Sustained greats (Pujols, Cabrera, Trout, Judge, Ohtani) stay at the top; a single
  career year (2005 Derrek Lee, 2006 Morneau) lands a tier below.

No park adjustment (documented simplification). If a matched player has no qualifying season in
the window but has one with ≥ 200 PA within ±4 years, that season is used decayed by **5% per
year outside the window** (`ratingMethod: "mlb-nearest"`).

### Non-MLB players (`ratingMethod: "heuristic"`)

`composite = tier × leagueMultiplier`, where tier B (regular starter) = 100 OPS+-equivalent and
tier C (bench / outside prime) = 85. Tier is assigned by a transparent heuristic: **B if age at
the edition is 23–34, otherwise C** (age 27 when the page has no birth date). The heuristic never
assigns tier A (125): foreign-league stats aren't programmatically available, so stars like 2023
Murakami get their level from the curated tiers below.

League multipliers (the first four are from the spec; the last two are documented additions so
Cuban National Series players and affiliated minor leaguers aren't lumped with amateurs):

| League | Multiplier |
|---|---|
| MLB (unmatched player on an MLB club) | 1.00 |
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

**Matched players on this path.** A player joined to Lahman who has no qualifying MLB season
near the edition is rated as affiliated minors (0.75), whatever his roster league, unless that
league is NPB, KBO, CPBL or the Cuban National Series: those keep their own multiplier. For the
same four leagues an `mlb-nearest` rating has a floor. When a decayed MLB season up to four
years away rates below `tier × league multiplier`, the heuristic composite is used instead and
the record is labeled `heuristic` (2006 Randall Simon, Orix: 25 → 52; 2013 Wladimir Balentien,
Yakult: 39 → 56).

### Curated foreign stars (`ratingMethod: "curated"`)

The tier heuristic can't see that 2023 Murakami was coming off 56 HR. The fix is a hand-curated
tier file, `data/curation/foreign-stars.json` (201 entries), under strict integrity rules:

- An entry can only **lift** a player who is already on a scraped roster: `(edition, exact
  roster name)` must match or the build fails. Curation can never invent a roster spot.
- Every entry cites a Wikipedia article. The build fetches each citation (cached) and fails on
  HTTP errors; it warns when the article doesn't mention the claimed league. (This caught two
  wrong-person redirects on the first run.)
- The applied composite is `max(computed, tierValue × league multiplier)`. It never lowers.
- Tiers: **S** = 150 (generational: 2023 Murakami, 2012 Abe, peak Yamada, 2006 Lee Seung-yeop,
  2026 Kim Do-yeong), **A+** = 135, **A** = 125, **B+** = 110. Where a player's accomplishments
  are thin or absent, they are deliberately *not* curated: absence of accomplishments is
  itself the signal, and the tier heuristic stands.

### Positional offense adjustment

The overall rating adds a positional adjustment to the composite (premium positions get bat
credit, like real positional adjustments): C +12, SS +7, CF +6, 2B/3B +4, corners 0, 1B −3,
DH −6, plus a small speed credit (`0.15 × (speed − 50)`). Defense remains a gated category in
the team-rating blend but no longer double-counts into the overall number.

### Composite → rating curve

Fixed anchors (OPS+-equivalent → rating), linearly interpolated. This is **not** a percentile
map, so 99 stays genuinely rare regardless of pool composition:

```
40→18  60→30  70→38  85→50  100→62  115→72  130→80  145→87  160→92  180→96  200→99
```

A hitter's overall rating puts `composite + positional adjustment + 0.15×(speed−50)` through
this curve (see the section above); defense does not enter it. A pitcher's overall rating is
the pitching composite through the same curve.

### Subratings

| Subrating | MLB-matched | Heuristic |
|---|---|---|
| `contact` | `AVG/lgAVG − 0.5×(K%/lgK% − 1)` through anchored curve | rating − 2 ± seeded noise |
| `power` | `ISO/lgISO` through anchored curve | rating − 8 ± seeded noise |
| `speed` | `(SB + 2×3B)/PA`, scaled (0.04 ≈ 62, 0.10+ ≈ 95) | position prior (CF/SS high, C/1B low) ± noise |
| `defense` | position baseline (C 68, SS 70, CF 68 … 1B 42, DH 25) ± fielding-pct adjustment vs .975, capped ±12 | baseline ± seeded noise |
| `clutch` | **flavor stat**: rating ± 5, seeded | same |

All randomness is seeded by player ID, so rebuilds are deterministic.

### Position eligibility (`positions`)

For matched players, positions come from `Appearances.csv` games by position (window ±1 year,
widening to ±4 when the narrow window has fewer than 20 games; never the whole career):
eligible where games ≥ max(10, 10% of appearances). This is how "true CF" is distinguished from corner outfielders. Unmatched players
keep their roster grouping: `IF` → 1B/2B/3B/SS, `OF` → LF/CF/RF, `UTL`/`U` → everything but C
and CF, compound listings like "SS/3B" (2026 pages) → exactly those. DH eligibility is implicit
for every hitter in the engine.

## Validation (runs inside the build; failures stop it)

- Every team-edition between 25–32 players, 26–31 expected; outside values are printed for
  manual review (the 2017 and some 2023 teams legitimately carried designated-pitcher pools and
  land at 33–38).
- Every hitter has ≥ 1 position; ≥ 9 hitters per team; no duplicate IDs; ratings within 1–99.
- Every pin in `lahman-fixes.json` names an existing record and Lahman id and cites a source.
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

The build stops when a curated id matches no record, an entry lacks a source, an alias breaks a
guard, or two people share a country and name letters without a `distinct` entry. It prints the
merges per rule and warns when one Lahman id joins records that cannot be one person (none
today). A wrong Lahman join is fixed where it happens, in `lahman-fixes.json`.

Current data: 3,175 records, 2,484 provisional keys, **2,303 distinct players**. The build
merged 181 keys: 58 by Lahman id, 17 by alias, 106 by name letters. `src/game/data.test.ts`
checks the shipped file: no key repeats within a team-edition, no two keys share sorted name
letters and a birth date, no undated key shares slug and country with a dated key unless listed
as distinct, every alias group shares one key, and the count in this paragraph matches the file.

## Data refresh log

### 2026-10: rating accuracy refresh

One rebuild fixed three kinds of identity and parsing errors:

- **Joins.** Names must agree on every Lahman join, and the same-name fallback accepts a
  birth-date typo, a teammate's copied date, or a swap (see "Matching roster names to Lahman
  IDs"). This removed three wrong joins (2013 Carlos González had Carlos Gómez's stats, both
  Lachlan Wells rows had his twin Alex's, 2006 Panama Ramón Ramírez had a Dominican reliever's)
  and recovered 50 joins that a roster birth-date error had blocked: 36 typos, 6 dates copied
  from a teammate, 1 swap, and 7 pins. One more join comes from the name-letters lookup (2006
  Yurendell de Caster, listed as "DeCaster").
- **Birth dates.** 95 birth dates printed as plain text are now read (2006 Australia, Italy and
  South Africa; 2009 Mexico). No existing date changed. They fix the age tier of veterans such
  as 2009 Ricardo Rincón and add 12 joins.
- **Foreign leagues.** Matched players on NPB, KBO, CPBL and Cuban rosters keep their league
  multiplier, with a floor on `mlb-nearest` (see "Non-MLB players").

Result: 134 overall ratings changed (98 up, 36 down) and 146 records changed at least one
field the engine reads. Record ids and order did not change. 60 personKeys changed, and the
distinct-player count went from 2,304 to 2,303: the 2006 Australia and 2009 South Africa Paul
Rutgers rows now share a birth date, and both link the same article. Ratings feed the seeded
simulation, so the same lineup simulates differently after this data deploy; it ships right
after a daily rollover so that no day mixes two rating sets.

Balance check (`npx tsx scripts/draft-bot-report.ts`, 3,000 bot drafts, before and after): p50
team rating 80.0 to 80.1, p50 7-0 rate 1.66% to 1.78%, p99 7-0 rate 5.91% to 6.01%, p50
median wins 4 to 4. `scripts/calibration-report.ts`: the synthetic lineups are unchanged; the
best real lineup moves from team 88.6 to 88.7 (2013 Hanley Ramírez takes third base).

<details>
<summary>All 134 changed overall ratings, largest change first</summary>

| Record | Player | Before | After | Change | Method | Reason |
|---|---|---:|---:|---:|---|---|
| `2006-pan-ramon-ramirez` | Ramon Ramírez | 70 | 38 | -32 | mlb-window to heuristic | Join removed: Dominican namesake |
| `2006-aus-rich-thompson` | Rich Thompson | 62 | 33 | -29 | heuristic | Joined: birth date read from text |
| `2006-ned-randall-simon` | Randall Simon | 25 | 52 | +27 | mlb-nearest to heuristic | Foreign-league rule (NPB) |
| `2009-pur-ivan-rodriguez` | Iván Rodríguez | 36 | 63 | +27 | heuristic to mlb-window | Joined: birth-date typo |
| `2013-dom-hanley-ramirez` | Hanley Ramírez | 68 | 93 | +25 | heuristic to mlb-window | Joined: birth-date typo |
| `2023-dom-wander-franco` | Wander Franco | 56 | 81 | +25 | heuristic to mlb-window | Joined: birth-date typo |
| `2009-dom-odalis-perez` | Odalis Pérez | 38 | 62 | +24 | heuristic to mlb-window | Joined: birth-date typo |
| `2026-cub-yariel-rodriguez` | Yariel Rodríguez | 42 | 65 | +23 | heuristic to mlb-window | Joined: birth-date typo |
| `2023-usa-jeff-mcneil` | Jeff McNeil | 56 | 76 | +20 | heuristic to mlb-window | Joined: roster has a teammate's birth date |
| `2017-isr-brad-goldberg` | Brad Goldberg | 62 | 42 | -20 | heuristic | Joined: birth-date typo |
| `2026-ven-luinder-avila` | Luinder Avila | 62 | 42 | -20 | heuristic | Joined: roster has a teammate's birth date |
| `2023-ned-chadwick-tromp` | Chadwick Tromp | 68 | 49 | -19 | heuristic | Joined: birth date swapped with a teammate |
| `2017-mex-carlos-torres` | Carlos Torres | 50 | 68 | +18 | heuristic to mlb-window | Joined: birth-date typo |
| `2023-ven-omar-narvaez` | Omar Narváez | 69 | 51 | -18 | heuristic to mlb-window | Pinned join |
| `2009-dom-jose-arredondo` | José Arredondo | 62 | 79 | +17 | heuristic to mlb-window | Joined: birth-date typo |
| `2013-mex-sergio-romo` | Sergio Romo | 62 | 79 | +17 | heuristic to mlb-window | Joined: birth-date typo |
| `2013-ned-wladimir-balentien` | Wladimir Balentien | 39 | 56 | +17 | mlb-nearest to heuristic | Foreign-league rule (NPB) |
| `2013-ita-anthony-rizzo` | Anthony Rizzo | 68 | 83 | +15 | heuristic to mlb-window | Joined: birth-date typo |
| `2006-ita-val-pascucci` | Val Pascucci | 41 | 55 | +14 | heuristic | Birth date read from text (age tier) |
| `2006-jpn-tsuyoshi-wada` | Tsuyoshi Wada | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2006-jpn-yasuhiko-yabuta` | Yasuhiko Yabuta | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2006-pur-dicky-gonzalez` | Dicky Gonzalez | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2013-can-dustin-molleken` | Dustin Molleken | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2013-can-scott-mathieson` | Scott Mathieson | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2013-jpn-hirokazu-sawamura` | Hirokazu Sawamura | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2013-ven-enrique-gonzalez` | Enrique González | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2013-ven-wil-ledezma` | Wil Ledezma | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2017-can-scott-mathieson` | Scott Mathieson | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2017-col-guillermo-moscoso` | Guillermo Moscoso | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2017-jpn-shintaro-fujinami` | Shintaro Fujinami | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2017-mex-brandon-laird` | Brandon Laird | 38 | 52 | +14 | heuristic | Foreign-league rule (NPB) |
| `2017-ned-rick-van-den-hurk` | Rick van den Hurk | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2017-ven-robert-suarez` | Robert Suárez | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2023-pan-alberto-baldonado` | Alberto Baldonado | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2023-pan-humberto-mejia` | Humberto Mejía | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2023-pan-javy-guerra` | Javy Guerra | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2023-ven-edwin-escobar` | Edwin Escobar | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2026-pan-alberto-baldonado` | Alberto Baldonado | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2026-pan-humberto-mejia` | Humberto Mejía | 42 | 56 | +14 | heuristic | Foreign-league rule (NPB) |
| `2006-aus-john-stephens` | John Stephens | 38 | 51 | +13 | heuristic to mlb-nearest | Joined: birth date read from text |
| `2009-jpn-munenori-kawasaki` | Munenori Kawasaki | 48 | 61 | +13 | mlb-nearest to heuristic | Foreign-league rule (NPB) |
| `2009-pur-hiram-bocachica` | Hiram Bocachica | 49 | 62 | +13 | heuristic | Foreign-league rule (NPB) |
| `2017-mex-luis-cruz` | Luis Cruz | 50 | 63 | +13 | heuristic | Foreign-league rule (NPB) |
| `2017-ned-wladimir-balentien` | Wladimir Balentien | 48 | 61 | +13 | heuristic | Foreign-league rule (NPB) |
| `2023-ita-sal-frelick` | Sal Frelick | 48 | 61 | +13 | heuristic to mlb-window | Joined: birth-date typo |
| `2023-pur-neftali-soto` | Neftalí Soto | 48 | 61 | +13 | heuristic | Foreign-league rule (NPB) |
| `2026-nca-jeter-downs` | Jeter Downs | 47 | 60 | +13 | heuristic | Foreign-league rule (NPB) |
| `2023-ita-david-fletcher` | David Fletcher | 67 | 54 | -13 | heuristic to mlb-window | Joined: roster has a teammate's birth date |
| `2013-aus-brad-thomas` | Brad Thomas | 35 | 47 | +12 | heuristic to mlb-nearest | Joined: birth-date typo |
| `2017-jpn-yuki-matsui` | Yuki Matsui | 33 | 45 | +12 | heuristic | Foreign-league rule (NPB) |
| `2009-mex-edgar-gonzalez` | Edgar Gonzalez | 68 | 56 | -12 | heuristic to mlb-window | Joined: birth date read from text |
| `2009-mex-jerry-hairston-jr` | Jerry Hairston Jr. | 67 | 78 | +11 | heuristic to mlb-window | Joined: birth date read from text |
| `2017-dom-jeurys-familia` | Jeurys Familia | 62 | 73 | +11 | heuristic to mlb-window | Joined: birth-date typo |
| `2017-usa-chris-archer` | Chris Archer | 62 | 73 | +11 | heuristic to mlb-window | Joined: birth-date typo |
| `2009-pan-ruben-tejada` | Rubén Tejada | 56 | 46 | -10 | heuristic to mlb-window | Pinned join |
| `2006-aus-dave-nilsson` | Dave Nilsson | 49 | 40 | -9 | heuristic | Birth date read from text (age tier) |
| `2006-aus-michael-collins` | Michael Collins | 47 | 38 | -9 | heuristic | Birth date read from text (age tier) |
| `2006-ita-james-buccheri` | James Buccheri | 44 | 35 | -9 | heuristic | Birth date read from text (age tier) |
| `2006-rsa-jonathan-phillips` | Jonathan Phillips | 45 | 36 | -9 | heuristic | Birth date read from text (age tier) |
| `2009-mex-erubiel-durazo` | Erubiel Durazo | 37 | 28 | -9 | heuristic | Birth date read from text (age tier) |
| `2009-mex-ricardo-rincon` | Ricardo Rincón | 42 | 33 | -9 | heuristic | Birth date read from text (age tier) |
| `2009-aus-chris-oxspring` | Chris Oxspring | 42 | 50 | +8 | heuristic | Foreign-league rule (KBO) |
| `2009-can-mike-johnson` | Mike Johnson | 42 | 50 | +8 | heuristic | Foreign-league rule (KBO) |
| `2009-kor-oh-seung-hwan` | Oh Seung-hwan | 42 | 50 | +8 | heuristic | Foreign-league rule (KBO) |
| `2009-mex-karim-garcia` | Karim García | 47 | 55 | +8 | heuristic | Birth date read from text (age tier) |
| `2026-aus-lachlan-wells` | Lachlan Wells | 42 | 50 | +8 | heuristic | Join removed: his twin's record |
| `2026-pan-ariel-jurado` | Ariel Jurado | 42 | 50 | +8 | heuristic | Foreign-league rule (KBO) |
| `2006-aus-adam-bright` | Adam Bright | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-aus-paul-mildren` | Paul Mildren | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-aus-paul-rutgers` | Paul Rutgers | 45 | 37 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-aus-phil-brassington` | Phil Brassington | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-ita-alex-maestri` | Alex Maestri | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-rsa-brett-willemburg` | Brett Willemburg | 44 | 36 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-rsa-robert-verschuren` | Robert Verschuren | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-rsa-tyrone-brandt` | Tyrone Brandt | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2006-rsa-tyrone-lamont` | Tyrone Lamont | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2009-mex-francisco-campos` | Francisco Campos | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2009-mex-rafael-diaz` | Rafael Díaz | 38 | 30 | -8 | heuristic | Birth date read from text (age tier) |
| `2013-kor-jaeweong-seo` | Jaeweong Seo | 33 | 40 | +7 | heuristic | Foreign-league rule (KBO) |
| `2017-kor-lim-chang-yong` | Lim Chang-yong | 33 | 40 | +7 | heuristic | Foreign-league rule (KBO) |
| `2023-kor-kim-hyun-soo` | Kim Hyun-soo | 39 | 46 | +7 | heuristic | Foreign-league rule (KBO) |
| `2023-kor-yang-hyeon-jong` | Yang Hyeon-jong | 33 | 40 | +7 | heuristic | Foreign-league rule (KBO) |
| `2013-jpn-kazuo-matsui` | Kazuo Matsui | 43 | 49 | +6 | mlb-nearest to heuristic | Foreign-league rule (NPB) |
| `2023-dom-willy-adames` | Willy Adames | 69 | 75 | +6 | heuristic to mlb-window | Joined: birth-date typo |
| `2026-can-matt-davidson` | Matt Davidson | 40 | 46 | +6 | heuristic | Foreign-league rule (KBO) |
| `2026-dom-albert-abreu` | Albert Abreu | 50 | 56 | +6 | mlb-nearest to heuristic | Foreign-league rule (NPB) |
| `2006-dom-jorge-sosa` | Jorge Sosa | 62 | 67 | +5 | heuristic to mlb-window | Joined: birth-date typo |
| `2006-ven-freddy-garcia` | Freddy García | 62 | 67 | +5 | heuristic to mlb-window | Joined: birth-date typo |
| `2009-aus-rich-thompson` | Rich Thompson | 62 | 67 | +5 | heuristic to mlb-nearest | Joined: birth-date typo |
| `2013-kor-daeho-lee` | Daeho Lee | 48 | 53 | +5 | mlb-nearest to heuristic | Foreign-league rule (NPB) |
| `2023-dom-nelson-cruz` | Nelson Cruz | 43 | 48 | +5 | heuristic to mlb-window | Joined: birth-date typo |
| `2006-aus-bradley-harman` | Bradley Harman | 45 | 40 | -5 | heuristic | Joined: birth date read from text |
| `2006-aus-luke-hughes` | Luke Hughes | 44 | 39 | -5 | heuristic | Joined: birth date read from text |
| `2006-ita-mark-saccomanno` | Mark Saccomanno | 44 | 48 | +4 | heuristic | Joined: birth date read from text |
| `2006-ita-phil-barzilla` | Phil Barzilla | 38 | 42 | +4 | heuristic | Joined: birth date read from text |
| `2006-ita-thomas-gregorio` | Thomas Gregorio | 45 | 49 | +4 | heuristic | Joined: birth date read from text |
| `2006-mex-roberto-ramirez` | Roberto Ramírez | 38 | 42 | +4 | heuristic | Joined: birth-date typo |
| `2006-ned-yurendell-decaster` | Yurendell DeCaster | 43 | 47 | +4 | heuristic | Joined: unique name, no roster birth date |
| `2009-aus-brad-thomas` | Brad Thomas | 50 | 54 | +4 | heuristic to mlb-window | Joined: birth-date typo |
| `2009-dom-juan-brito` | Juan Brito | 47 | 51 | +4 | heuristic | Joined: birth-date typo |
| `2013-ven-carlos-gonzalez` | Carlos González | 85 | 89 | +4 | mlb-window | Pinned to his own record (was Carlos Gómez) |
| `2017-kor-kim-ha-seong` | Kim Ha-seong | 42 | 46 | +4 | mlb-nearest to heuristic | Foreign-league rule (KBO) |
| `2023-cub-erisbel-arruebarrena` | Erisbel Arruebarrena | 48 | 52 | +4 | heuristic | Foreign-league rule (Cuba) |
| `2023-pan-severino-gonzalez` | Severino González | 38 | 42 | +4 | heuristic | Joined: birth-date typo |
| `2026-cub-erisbel-arruebarrena` | Erisbel Arruebarrena | 39 | 43 | +4 | heuristic | Foreign-league rule (Cuba) |
| `2026-mex-roel-ramirez` | Roel Ramírez | 38 | 42 | +4 | heuristic | Joined: birth-date typo |
| `2009-mex-francisco-rodriguez` | Francisco Rodríguez | 62 | 58 | -4 | heuristic to mlb-window | Joined: birth date read from text |
| `2009-mex-luis-ignacio-ayala` | Luis Ignacio Ayala | 62 | 58 | -4 | heuristic to mlb-window | Joined: birth date read from text |
| `2017-isr-sam-fuld` | Sam Fuld | 44 | 40 | -4 | heuristic to mlb-nearest | Pinned join |
| `2013-cub-andy-ibanez` | Andy Ibáñez | 39 | 42 | +3 | heuristic | Foreign-league rule (Cuba) |
| `2013-cub-darien-nunez` | Darien Núñez | 33 | 36 | +3 | heuristic | Foreign-league rule (Cuba) |
| `2013-ita-brian-sweeney` | Brian Sweeney | 30 | 33 | +3 | heuristic | Joined: birth-date typo |
| `2017-tpe-lin-che-hsuan` | Lin Che-hsuan | 49 | 52 | +3 | heuristic | Foreign-league rule (CPBL) |
| `2026-cub-alexei-ramirez` | Alexei Ramírez | 40 | 43 | +3 | heuristic | Foreign-league rule (Cuba) |
| `2006-dom-odalis-perez` | Odális Pérez | 62 | 59 | -3 | heuristic to mlb-window | Pinned join |
| `2023-dom-roansy-contreras` | Roansy Contreras | 62 | 59 | -3 | heuristic to mlb-window | Joined: birth-date typo |
| `2006-can-eric-cyr` | Éric Cyr | 42 | 44 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2017-can-scott-richmond` | Scott Richmond | 33 | 35 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2017-jpn-hirokazu-sawamura` | Hirokazu Sawamura | 54 | 56 | +2 | mlb-nearest to heuristic | Foreign-league rule (NPB) |
| `2017-tpe-hu-chin-lung` | Hu Chin-lung | 48 | 50 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2017-tpe-ni-fu-te` | Ni Fu-te | 33 | 35 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2023-tpe-c-c-lee` | C. C. Lee | 33 | 35 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2023-tpe-chih-wei-hu` | Chih-Wei Hu | 42 | 44 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2023-tpe-wei-chung-wang` | Wei-Chung Wang | 42 | 44 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2023-ven-eduardo-escobar` | Eduardo Escobar | 57 | 59 | +2 | heuristic to mlb-window | Joined: birth-date typo |
| `2026-can-jordan-balazovic` | Jordan Balazovic | 42 | 44 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2026-tpe-chih-wei-hu` | Chih-Wei Hu | 42 | 44 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2026-tpe-tzu-wei-lin` | Tzu-Wei Lin | 49 | 51 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2026-tpe-yu-chang` | Yu Chang | 48 | 50 | +2 | heuristic | Foreign-league rule (CPBL) |
| `2006-aus-trent-oeltjen` | Trent Oeltjen | 45 | 43 | -2 | heuristic | Joined: birth date read from text |
| `2013-dom-erick-aybar` | Erick Aybar | 68 | 69 | +1 | heuristic to mlb-window | Pinned join |
| `2023-col-adrian-sanchez` | Adrián Sánchez | 46 | 47 | +1 | heuristic | Joined: roster has a teammate's birth date |
| `2023-ita-andre-pallante` | Andre Pallante | 62 | 61 | -1 | heuristic to mlb-window | Joined: birth-date typo |
| `2026-pan-jose-caballero` | José Caballero | 69 | 68 | -1 | heuristic to mlb-window | Pinned join |

</details>

## Known limitations (v1)

- NPB/KBO/CPBL/Cuban stars without MLB careers and without a curated tier rate as tier B
  regulars: their real stats aren't programmatically available in the databank.
- 2023 Israel and 2023 Venezuela have no CF-refined hitter; the draft engine must tolerate
  rosters with no eligible player for a specific open slot.
- "Eastern League" (ambiguous between MiLB AA and the NPB farm league) is classified as MiLB.
- No park factors; single-season basis means hot seasons (2005 Derrek Lee) rate at their peak.
