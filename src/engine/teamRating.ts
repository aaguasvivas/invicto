// Lineup → team rating. The five category means are blended with a generalized
// power mean with negative exponent (a "soft minimum"): one terrible category caps
// the ceiling no matter how strong the rest is. That gating is what makes 7-0 rare.
//
// Tuning constants here are pinned by the Monte Carlo test (montecarlo.test.ts):
// retune there if you touch them. See README "Tuning".

import type { EnginePlayer } from './types';

export const CATEGORIES = ['contact', 'power', 'speed', 'defense', 'clutch'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Equal weights: the spec wants ANY terrible category to cap the ceiling. */
export const RATING_WEIGHTS: Record<Category, number> = {
  contact: 0.2,
  power: 0.2,
  speed: 0.2,
  defense: 0.2,
  clutch: 0.2,
};

/** Soft-min exponent: more negative = harsher gating. */
export const SOFTMIN_P = -4;

/** Linear calibration from blend space onto the opponent-rating scale. */
export const CAL_A = 38;
export const CAL_B = 0.634;

export function categoryMeans(lineup: EnginePlayer[]): Record<Category, number> {
  const out = {} as Record<Category, number>;
  for (const cat of CATEGORIES) {
    out[cat] = lineup.reduce((sum, p) => sum + p[cat], 0) / lineup.length;
  }
  return out;
}

/** Generalized power mean with exponent p < 0 — approaches min() as p → −∞. */
export function softMin(values: number[], weights: number[], p: number = SOFTMIN_P): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += weights[i] * Math.max(1, values[i]) ** p;
  }
  return sum ** (1 / p);
}

export function teamRating(lineup: EnginePlayer[]): number {
  const means = categoryMeans(lineup);
  const blend = softMin(
    CATEGORIES.map((c) => means[c]),
    CATEGORIES.map((c) => RATING_WEIGHTS[c]),
  );
  return Math.max(1, Math.min(99, CAL_A + CAL_B * blend));
}
