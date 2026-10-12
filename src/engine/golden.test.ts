// Golden values for the daily contract: the same seed deals the same rolls and plays
// the same tournament for the same lineup, for every player, on every day.
//
// A failure here means every daily re-deals. Change these literals only on an explicit
// owner decision, never to make a refactor pass. New random draws go after the existing
// ones or on a new rngFor path, and new cases are added below the existing ones.
//
// The literals were computed at commit 1f59a51. Rolls read public/data/editions.json on
// purpose, because a change to the edition list re-deals dailies too. Lineups are
// synthetic (test-helpers), so a rebuild of players.json never touches this file.

import { describe, expect, test } from 'vitest';
import editionsJson from '../../public/data/editions.json';
import { rollBase, rollCountryReroll, rollEditionReroll, rollRedraw } from './draft';
import { rngFor } from './rng';
import { simulateRun } from './simulate';
import { teamRating } from './teamRating';
import { lineupWithMeans } from './test-helpers';
import type { EditionTeams, Roll, RunResult } from './types';

// Same shape the game builds in src/game/data.ts: edition year to country codes.
const TEAMS: EditionTeams = Object.fromEntries(
  editionsJson.editions.map((e) => [e.year, e.teams.map((team) => team.code)]),
);

// The Monte Carlo trio: a casual draft, an elite draft, and five great categories
// with one disaster (the soft-min gate).
const LINEUPS = {
  casual: () => lineupWithMeans(72, 70, 56, 58, 72, 70),
  elite: () => lineupWithMeans(85, 88, 62, 60, 85, 84),
  gated: () => lineupWithMeans(95, 95, 95, 95, 40, 95),
};

describe('rngFor', () => {
  test('the first draws of the round 0 roll stream are pinned', () => {
    const rng = rngFor('daily-2026-06-11', 'roll', 0);
    expect([rng(), rng(), rng()]).toEqual([0.27653671568259597, 0.9957196675240993, 0.24011456593871117]);
  });
});

// Rounds 0 to 11 of each stream, one roll per round written as country + edition.
// Rerolls start from that round's base roll; redraws are attempts 1 and 2.
// Seeds: two dailies and one in the free and hard mode format.
const DEALS: Record<string, Record<string, string>> = {
  'daily-2026-06-11': {
    base: 'VEN2009 DOM2006 VEN2009 DOM2013 VEN2013 KOR2026 BRA2026 DOM2017 USA2026 DOM2013 MEX2023 PUR2009',
    countryReroll: 'TPE2009 PAN2006 RSA2009 KOR2013 DOM2013 CZE2026 TPE2026 PUR2017 KOR2026 CUB2013 CAN2023 CUB2009',
    editionReroll: 'VEN2013 DOM2009 VEN2017 DOM2009 VEN2026 KOR2017 BRA2013 DOM2009 USA2017 DOM2017 MEX2009 PUR2026',
    redraw1: 'CHN2013 CAN2026 COL2017 NCA2023 DOM2026 CZE2023 TPE2006 TPE2017 KOR2017 BRA2013 TPE2026 PUR2013',
    redraw2: 'NCA2023 ESP2013 CZE2026 ISR2017 USA2006 DOM2006 CUB2009 USA2017 CUB2023 MEX2006 ITA2013 KOR2026',
  },
  'daily-2026-10-11': {
    base: 'DOM2009 USA2017 MEX2009 JPN2026 NCA2023 ISR2026 USA2006 JPN2006 DOM2013 ITA2006 MEX2026 MEX2009',
    countryReroll: 'JPN2009 PUR2017 NED2009 ITA2026 COL2023 JPN2026 JPN2006 MEX2006 VEN2013 USA2006 PAN2026 KOR2009',
    editionReroll: 'DOM2013 USA2026 MEX2017 JPN2017 NCA2026 ISR2017 USA2023 JPN2026 DOM2009 ITA2009 MEX2023 MEX2023',
    redraw1: 'USA2017 USA2026 CUB2009 JPN2013 DOM2023 ISR2023 MEX2009 NED2017 ESP2013 MEX2013 ISR2017 CUB2026',
    redraw2: 'CUB2017 ESP2013 RSA2006 MEX2026 TPE2026 DOM2023 PAN2009 DOM2023 CUB2026 CUB2013 CZE2026 KOR2009',
  },
  'free-mg5x2k7q-8f3k1z': {
    base: 'JPN2006 CHN2013 CHN2023 DOM2009 ITA2026 JPN2013 NCA2023 COL2023 MEX2013 PAN2009 JPN2006 VEN2006',
    countryReroll: 'VEN2006 JPN2013 TPE2023 PUR2009 JPN2026 ESP2013 PUR2023 ISR2023 CUB2013 TPE2009 PUR2006 CAN2006',
    editionReroll: 'JPN2013 CHN2017 CHN2006 DOM2023 ITA2023 JPN2023 NCA2026 COL2026 MEX2006 PAN2023 JPN2013 VEN2017',
    redraw1: 'PUR2026 TPE2009 VEN2026 CUB2023 ESP2013 GBR2023 ISR2023 VEN2009 JPN2026 USA2026 PUR2009 CHN2009',
    redraw2: 'DOM2026 ESP2013 VEN2006 RSA2006 DOM2009 USA2026 VEN2009 VEN2026 CUB2017 USA2013 NED2013 MEX2006',
  },
};

function twelveRounds(rollAt: (round: number) => Roll): string {
  return Array.from({ length: 12 }, (_, round) => rollAt(round))
    .map((roll) => `${roll.country}${roll.edition}`)
    .join(' ');
}

describe('draft deal', () => {
  test.each(Object.entries(DEALS))('%s deals the pinned rolls, rerolls and redraws', (seed, expected) => {
    const base = (round: number) => rollBase(seed, round, TEAMS);
    expect({
      base: twelveRounds(base),
      countryReroll: twelveRounds((round) => rollCountryReroll(seed, round, base(round), TEAMS)),
      editionReroll: twelveRounds((round) => rollEditionReroll(seed, round, base(round), TEAMS)),
      redraw1: twelveRounds((round) => rollRedraw(seed, round, 1, TEAMS)),
      redraw2: twelveRounds((round) => rollRedraw(seed, round, 2, TEAMS)),
    }).toEqual(expected);
  });
});

describe('teamRating', () => {
  test('the three synthetic lineups keep their ratings', () => {
    expect(teamRating(LINEUPS.casual())).toBe(77.96053826195957);
    expect(teamRating(LINEUPS.elite())).toBe(82.92110042889911);
    expect(teamRating(LINEUPS.gated())).toBe(75.36833854962009);
  });
});

const CASUAL_JUNE_11: RunResult = {
  teamRating: 77.96053826195957,
  games: [
    {
      stage: 'pool-1', opponent: { country: 'AUS', rating: 62 }, win: true, teamScore: 11, oppScore: 4,
      mercy: false, walkOff: false, flavorKey: 'win-blowout', flavorVariant: 5,
      hero: { slot: '2B', kind: 'slugger', n1: 1, n2: 1 },
    },
    {
      stage: 'pool-2', opponent: { country: 'CHN', rating: 56 }, win: true, teamScore: 8, oppScore: 0,
      mercy: false, walkOff: false, flavorKey: 'win-shutout', flavorVariant: 0,
      hero: { slot: 'SP', kind: 'starter', n1: 7, n2: 9 },
    },
    {
      stage: 'pool-3', opponent: { country: 'COL', rating: 70 }, win: false, teamScore: 3, oppScore: 6,
      mercy: false, walkOff: false, flavorKey: 'loss-normal', flavorVariant: 4,
      hero: null,
    },
    {
      stage: 'pool-4', opponent: { country: 'VEN', rating: 77 }, win: true, teamScore: 8, oppScore: 6,
      mercy: false, walkOff: false, flavorKey: 'win-close', flavorVariant: 4,
      hero: { slot: 'LF', kind: 'slugger', n1: 1, n2: 4 },
    },
    {
      stage: 'qf', opponent: { country: 'USA', rating: 78 }, win: false, teamScore: 4, oppScore: 6,
      mercy: false, walkOff: false, flavorKey: 'loss-close', flavorVariant: 4,
      hero: { slot: 'SS', kind: 'goatK', n1: 0, n2: 0 },
    },
  ],
  wins: 3,
  losses: 2,
  outcome: 'eliminated-qf',
};

// Reaches the final, so all seven scheduled opponents are pinned.
const CASUAL_OCTOBER_11: RunResult = {
  teamRating: 77.96053826195957,
  games: [
    {
      stage: 'pool-1', opponent: { country: 'ITA', rating: 64 }, win: true, teamScore: 8, oppScore: 2,
      mercy: false, walkOff: false, flavorKey: 'win-blowout', flavorVariant: 3,
      hero: { slot: 'LF', kind: 'contact', n1: 5, n2: 5 },
    },
    {
      stage: 'pool-2', opponent: { country: 'CAN', rating: 64 }, win: true, teamScore: 12, oppScore: 4,
      mercy: false, walkOff: false, flavorKey: 'win-blowout', flavorVariant: 5,
      hero: { slot: '3B', kind: 'slugger', n1: 2, n2: 3 },
    },
    {
      stage: 'pool-3', opponent: { country: 'CUB', rating: 78 }, win: false, teamScore: 3, oppScore: 6,
      mercy: false, walkOff: false, flavorKey: 'loss-normal', flavorVariant: 0,
      hero: null,
    },
    {
      stage: 'pool-4', opponent: { country: 'BRA', rating: 56 }, win: true, teamScore: 13, oppScore: 5,
      mercy: false, walkOff: false, flavorKey: 'win-blowout', flavorVariant: 5,
      hero: { slot: 'CF', kind: 'contact', n1: 4, n2: 4 },
    },
    {
      stage: 'qf', opponent: { country: 'PUR', rating: 78 }, win: true, teamScore: 5, oppScore: 1,
      mercy: false, walkOff: false, flavorKey: 'win-normal', flavorVariant: 3,
      hero: { slot: 'SS', kind: 'contact', n1: 3, n2: 4 },
    },
    {
      stage: 'sf', opponent: { country: 'JPN', rating: 84 }, win: true, teamScore: 1, oppScore: 0,
      mercy: false, walkOff: false, flavorKey: 'win-shutout', flavorVariant: 5,
      hero: { slot: 'SP', kind: 'starter', n1: 6, n2: 10 },
    },
    {
      stage: 'final', opponent: { country: 'DOM', rating: 90 }, win: false, teamScore: 5, oppScore: 9,
      mercy: false, walkOff: false, flavorKey: 'loss-normal', flavorVariant: 1,
      hero: null,
    },
  ],
  wins: 5,
  losses: 2,
  outcome: 'subcampeon',
};

// Outcome, record and scores for every lineup on every seed.
const RECORDS: Record<string, Record<keyof typeof LINEUPS, string>> = {
  'daily-2026-06-11': {
    casual: 'eliminated-qf 3-2: AUS 11-4, CHN 8-0, COL 3-6, VEN 8-6, USA 4-6',
    elite: 'eliminated-sf 4-2: AUS 12-4, CHN 9-0, COL 3-6, VEN 9-6, USA 7-4, JPN 2-5',
    gated: 'eliminated-qf 3-2: AUS 10-4, CHN 8-0, COL 3-6, VEN 7-6, USA 4-6',
  },
  'daily-2026-10-11': {
    casual: 'subcampeon 5-2: ITA 8-2, CAN 12-4, CUB 3-6, BRA 13-5, PUR 5-1, JPN 1-0, DOM 5-9',
    elite: 'subcampeon 5-2: ITA 10-2, CAN 13-4, CUB 3-5, BRA 14-5, PUR 6-1, JPN 1-0, DOM 5-8',
    gated: 'subcampeon 5-2: ITA 8-2, CAN 11-4, CUB 3-7, BRA 13-5, PUR 4-1, JPN 1-0, DOM 5-10',
  },
  'free-mg5x2k7q-8f3k1z': {
    casual: 'eliminated-sf 4-2: ESP 13-4, ITA 10-4, AUS 5-6, CUB 7-5, NED 3-2, VEN 3-7',
    elite: 'eliminated-sf 5-1: ESP 14-4, ITA 11-4, AUS 10-5, CUB 8-5, NED 5-2, VEN 3-6',
    gated: 'eliminated-sf 4-2: ESP 12-4, ITA 9-4, AUS 5-6, CUB 7-5, NED 3-2, VEN 3-8',
  },
};

function record(run: RunResult): string {
  const scores = run.games.map((g) => `${g.opponent.country} ${g.teamScore}-${g.oppScore}`).join(', ');
  return `${run.outcome} ${run.wins}-${run.losses}: ${scores}`;
}

describe('simulateRun', () => {
  test('casual lineup on daily-2026-06-11: the full run, out in the quarterfinal', () => {
    expect(simulateRun(LINEUPS.casual(), 'daily-2026-06-11')).toEqual(CASUAL_JUNE_11);
  });

  test('casual lineup on daily-2026-10-11: the full run, through to the final', () => {
    expect(simulateRun(LINEUPS.casual(), 'daily-2026-10-11')).toEqual(CASUAL_OCTOBER_11);
  });

  test.each(Object.entries(RECORDS))('%s keeps every lineup on its pinned record', (seed, expected) => {
    const records = Object.fromEntries(
      Object.entries(LINEUPS).map(([name, lineup]) => [name, record(simulateRun(lineup(), seed))]),
    );
    expect(records).toEqual(expected);
  });
});
