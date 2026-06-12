// Tournament simulation: 4 pool games → QF → SF → final, all seeded.
// Opponent strengths are scripted per slot (spec): pool = one minnow, two mids,
// one power; knockout rounds are powers at 78/84/90. Win probability is a
// logistic curve on (teamRating − opponentRating) with small per-game noise.

import { POWERS } from './draft';
import { HITTER_SLOTS } from './positions';
import { rngFor } from './rng';
import { teamRating } from './teamRating';
import type { GameResult, HeroMoment, LineupSlots, Outcome, RunResult, Slot, Stage } from './types';

export const LOGISTIC_SCALE = 7;
export const GAME_NOISE_SD = 3;
export const KNOCKOUT_RATINGS = { qf: 78, sf: 84, final: 90 } as const;
export const POOL_TIERS = {
  minnow: { base: 55, spread: 4 },
  mid: { base: 66, spread: 4 },
  power: { base: 78, spread: 3 },
} as const;

// Identity pools for opponent flags (flavor only — strength comes from the tier).
const MINNOW_COUNTRIES = ['CHN', 'CZE', 'GBR', 'NCA', 'BRA', 'RSA', 'ESP', 'ISR'];
const MID_COUNTRIES = ['CAN', 'ITA', 'AUS', 'PAN', 'COL'];

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
}

interface Opponent {
  country: string;
  rating: number;
}

/** Pool order + knockout opponents, all distinct countries, seeded. */
function scheduleOpponents(seed: string): { stage: Stage; opponent: Opponent }[] {
  const rng = rngFor(seed, 'opponents');
  const minnows = shuffle(MINNOW_COUNTRIES, rng);
  const mids = shuffle(MID_COUNTRIES, rng);
  const powers = shuffle(POWERS, rng);
  const poolSlots = shuffle(
    [
      { country: minnows[0], rating: POOL_TIERS.minnow.base + (rng() * 2 - 1) * POOL_TIERS.minnow.spread },
      { country: mids[0], rating: POOL_TIERS.mid.base + (rng() * 2 - 1) * POOL_TIERS.mid.spread },
      { country: mids[1], rating: POOL_TIERS.mid.base + (rng() * 2 - 1) * POOL_TIERS.mid.spread },
      { country: powers[0], rating: POOL_TIERS.power.base + (rng() * 2 - 1) * POOL_TIERS.power.spread },
    ],
    rng,
  );
  return [
    ...poolSlots.map((opponent, i) => ({ stage: `pool-${i + 1}` as Stage, opponent })),
    { stage: 'qf', opponent: { country: powers[1], rating: KNOCKOUT_RATINGS.qf } },
    { stage: 'sf', opponent: { country: powers[2], rating: KNOCKOUT_RATINGS.sf } },
    { stage: 'final', opponent: { country: powers[3], rating: KNOCKOUT_RATINGS.final } },
  ];
}

/**
 * Pick this game's star (or goat) from YOUR lineup. Drawn strictly AFTER every
 * other random draw in playGame so adding moments never changed past results.
 */
function heroMoment(
  lineup: LineupSlots,
  win: boolean,
  margin: number,
  shutout: boolean,
  walkOff: boolean,
  rng: () => number,
): HeroMoment | null {
  if (!win) {
    if (margin > 2 || rng() >= 0.45) return null;
    if (walkOff && lineup.CL) return { slot: 'CL', kind: 'goatBlown', n1: 0, n2: 0 };
    const hitters = HITTER_SLOTS.filter((s) => lineup[s]);
    if (hitters.length === 0) return null;
    const slot = hitters[Math.floor(rng() * hitters.length)];
    return { slot, kind: 'goatK', n1: 0, n2: 0 };
  }
  if (shutout && lineup.SP && rng() < 0.7) {
    return { slot: 'SP', kind: 'starter', n1: 6 + Math.floor(rng() * 3), n2: 7 + Math.floor(rng() * 7) };
  }
  if (margin <= 2 && lineup.CL && rng() < 0.5) {
    return { slot: 'CL', kind: 'closer', n1: 1 + Math.floor(rng() * 3), n2: 0 };
  }
  // Clutch finally pays rent: hitters weighted by (clutch + rating).
  const hitters = HITTER_SLOTS.filter((s): s is Slot => Boolean(lineup[s]));
  if (hitters.length === 0) return null;
  const weights = hitters.map((s) => lineup[s]!.clutch + lineup[s]!.rating);
  let pickAt = rng() * weights.reduce((a, b) => a + b, 0);
  let slot = hitters[hitters.length - 1];
  for (let i = 0; i < hitters.length; i++) {
    pickAt -= weights[i];
    if (pickAt <= 0) {
      slot = hitters[i];
      break;
    }
  }
  if (rng() < 0.55) {
    const hr = margin >= 6 ? 1 + Math.floor(rng() * 2) : 1;
    return { slot, kind: 'slugger', n1: hr, n2: hr + Math.floor(rng() * 4) };
  }
  const ab = 4 + Math.floor(rng() * 2);
  return { slot, kind: 'contact', n1: 3 + Math.floor(rng() * (ab - 2)), n2: ab };
}

function playGame(team: number, stage: Stage, opponent: Opponent, seed: string, lineup: LineupSlots): GameResult {
  const rng = rngFor(seed, 'game', stage);
  const gap = team - opponent.rating + gaussian(rng) * GAME_NOISE_SD;
  const winProb = 1 / (1 + Math.exp(-gap / LOGISTIC_SCALE));
  const win = rng() < winProb;

  // Scores: margin grows with the (signed) strength gap in the winner's favor.
  const winnerGap = win ? Math.max(0, gap) : Math.max(0, -gap);
  const margin = Math.min(18, 1 + Math.floor(rng() * 3) + Math.round(winnerGap / 4));
  const loserScore = Math.floor(rng() * 5 + rng() * 2); // 0 ≈ 5% — shutouts stay special
  const winnerScore = loserScore + margin;
  const mercy = margin >= 10;
  const walkOff = margin === 1 && rng() < 0.3;
  const shutout = loserScore === 0;
  const flavorBase = win ? 'win' : 'loss';
  const flavorKind = mercy ? 'mercy' : walkOff ? 'walkoff' : shutout ? 'shutout' : margin >= 6 ? 'blowout' : margin <= 2 ? 'close' : 'normal';

  const flavorVariant = Math.floor(rng() * 8);
  // hero draws come last — see heroMoment()
  const hero = heroMoment(lineup, win, margin, shutout, walkOff, rng);

  return {
    stage,
    opponent: { country: opponent.country, rating: Math.round(opponent.rating) },
    win,
    teamScore: win ? winnerScore : loserScore,
    oppScore: win ? loserScore : winnerScore,
    mercy,
    walkOff,
    flavorKey: `${flavorBase}-${flavorKind}`,
    flavorVariant,
    hero,
  };
}

export function simulateRun(lineup: LineupSlots, seed: string): RunResult {
  const team = teamRating(lineup);
  const schedule = scheduleOpponents(seed);
  const games: GameResult[] = [];

  for (const { stage, opponent } of schedule.slice(0, 4)) {
    games.push(playGame(team, stage, opponent, seed, lineup));
  }
  const poolWins = games.filter((g) => g.win).length;

  let outcome: Outcome;
  if (poolWins < 3) {
    outcome = 'eliminated-pool';
  } else {
    outcome = 'eliminated-qf';
    for (const { stage, opponent } of schedule.slice(4)) {
      const game = playGame(team, stage, opponent, seed, lineup);
      games.push(game);
      if (!game.win) {
        outcome = stage === 'qf' ? 'eliminated-qf' : stage === 'sf' ? 'eliminated-sf' : 'subcampeon';
        break;
      }
      if (stage === 'final') {
        outcome = games.every((g) => g.win) ? 'invicto' : 'campeon';
      }
    }
  }

  const wins = games.filter((g) => g.win).length;
  return { teamRating: team, games, wins, losses: games.length - wins, outcome };
}
