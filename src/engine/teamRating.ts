// Lineup → team rating. Five hitter category means plus a pitching category
// (mean rating of the SP/RP/CL slots) are blended with a generalized power mean
// with negative exponent (a "soft minimum"): one terrible category caps the
// ceiling no matter how strong the rest is. That gating is what makes 7-0 rare.
//
// Tuning constants here are pinned by the Monte Carlo test (montecarlo.test.ts):
// retune there if you touch them. See README "Tuning".

import { HITTER_SLOTS, PITCHER_SLOTS } from './positions';
import type { EnginePlayer, LineupSlots } from './types';

export const HITTER_CATEGORIES = ['contact', 'power', 'speed', 'defense', 'clutch'] as const;
export type Category = (typeof HITTER_CATEGORIES)[number] | 'pitching';
export const CATEGORIES: readonly Category[] = [...HITTER_CATEGORIES, 'pitching'];

/** Equal weights: the spec wants ANY terrible category to cap the ceiling. */
export const RATING_WEIGHTS: Record<Category, number> = {
  contact: 1 / 6,
  power: 1 / 6,
  speed: 1 / 6,
  defense: 1 / 6,
  clutch: 1 / 6,
  pitching: 1 / 6,
};

/** Soft-min exponent: more negative = harsher gating. */
export const SOFTMIN_P = -4;

/** Linear calibration from blend space onto the opponent-rating scale. */
export const CAL_A = 37.1;
export const CAL_B = 0.634;

export function categoryMeans(lineup: EnginePlayer[]): Record<(typeof HITTER_CATEGORIES)[number], number> {
  const out = {} as Record<(typeof HITTER_CATEGORIES)[number], number>;
  for (const cat of HITTER_CATEGORIES) {
    out[cat] = lineup.reduce((sum, p) => sum + p[cat], 0) / lineup.length;
  }
  return out;
}

/** Generalized power mean with exponent p < 0; approaches min() as p → −∞. */
export function softMin(values: number[], weights: number[], p: number = SOFTMIN_P): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += weights[i] * Math.max(1, values[i]) ** p;
  }
  return sum ** (1 / p);
}

/**
 * The six values the rating blends: the hitters' category means and the mean
 * rating of the SP/RP/CL slots (50 with no pitcher). A lineup with no hitter
 * yet takes its hitter means from whoever it has.
 */
export function categoryRatings(lineup: LineupSlots): Record<Category, number> {
  const hitters = HITTER_SLOTS.map((s) => lineup[s]).filter((p): p is EnginePlayer => Boolean(p));
  const pitchers = PITCHER_SLOTS.map((s) => lineup[s]).filter((p): p is EnginePlayer => Boolean(p));
  const means = categoryMeans(hitters.length > 0 ? hitters : Object.values(lineup) as EnginePlayer[]);
  const pitching = pitchers.length > 0 ? pitchers.reduce((sum, p) => sum + p.rating, 0) / pitchers.length : 50;
  return { ...means, pitching };
}

/** The soft-min blend of the six values, before calibration. */
export function categoryBlend(values: Record<Category, number>): number {
  return softMin(
    CATEGORIES.map((c) => values[c]),
    CATEGORIES.map((c) => RATING_WEIGHTS[c]),
  );
}

/** Six category values → team rating on the opponent scale, clamped to 1..99. */
export function ratingFromCategories(values: Record<Category, number>): number {
  return Math.max(1, Math.min(99, CAL_A + CAL_B * categoryBlend(values)));
}

export function teamRating(lineup: LineupSlots): number {
  return ratingFromCategories(categoryRatings(lineup));
}
