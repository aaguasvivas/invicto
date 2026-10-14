// Achievements. evaluateBadges is pure (lineup + finished run → ids earned by
// that run); persistence is per-device localStorage, same as streaks.

import type { LineupSlots, RunResult } from '../engine/types';
import * as storage from './storage';

export const BADGE_IDS = [
  'invicto',
  'campeon',
  'matagigantes',
  'sin_estrellas',
  'una_sola_edicion',
  'vuelta_al_mundo',
  'seis_editiones',
  'blanqueada_final',
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

const STORE_KEY = 'invicto.badges';
const EDITIONS = [2006, 2009, 2013, 2017, 2023, 2026];
/**
 * Picks from one edition for una_sola_edicion. All 12 was out of reach: each
 * round's edition comes from its own roll, and in 100,000 dealt drafts no
 * edition held more than 9 of the 12 rolls. 7 or more comes up in about 1% of
 * drafts, more with the edition reroll.
 */
const ONE_EDITION_PICKS = 7;

/** Badge ids this run earns (regardless of what was already unlocked). */
export function evaluateBadges(lineup: LineupSlots, run: RunResult): BadgeId[] {
  const players = Object.values(lineup).filter((p) => p != null);
  const won = run.outcome === 'invicto' || run.outcome === 'campeon';
  const finalGame = run.games.find((g) => g.stage === 'final');
  const earned: BadgeId[] = [];
  const perEdition = (year: number) => players.filter((p) => p.edition === year).length;

  if (run.outcome === 'invicto') earned.push('invicto');
  if (won) earned.push('campeon');
  if (won && players.filter((p) => p.rating < 60).length >= 5) earned.push('matagigantes');
  if (won && players.every((p) => p.rating < 80)) earned.push('sin_estrellas');
  if (EDITIONS.some((year) => perEdition(year) >= ONE_EDITION_PICKS)) earned.push('una_sola_edicion');
  if (players.length === 12 && new Set(players.map((p) => p.country)).size === 12) earned.push('vuelta_al_mundo');
  if (EDITIONS.every((year) => players.some((p) => p.edition === year))) earned.push('seis_editiones');
  if (finalGame?.win && finalGame.oppScore === 0) earned.push('blanqueada_final');

  return earned;
}

/** Map of badge id → first-earned ISO date. */
export function earnedBadges(): Partial<Record<BadgeId, string>> {
  const raw = storage.get(STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<Record<BadgeId, string>>;
  } catch {
    return {};
  }
}

export function earnedBadgeCount(): number {
  return Object.keys(earnedBadges()).length;
}

/** Of these badges, the ones first earned at or after a moment (epoch ms). */
export function badgesEarnedSince(ids: BadgeId[], since: number): BadgeId[] {
  const store = earnedBadges();
  return ids.filter((id) => {
    const at = store[id];
    return at !== undefined && Date.parse(at) >= since;
  });
}

/** Persist this run's badges; returns only the ones earned for the first time. */
export function recordBadges(ids: BadgeId[]): BadgeId[] {
  const store = earnedBadges();
  const fresh = ids.filter((id) => !store[id]);
  if (fresh.length > 0) {
    for (const id of fresh) store[id] = new Date().toISOString();
    storage.set(STORE_KEY, JSON.stringify(store));
  }
  return fresh;
}
