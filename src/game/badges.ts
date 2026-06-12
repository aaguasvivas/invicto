// Achievements. evaluateBadges is pure (lineup + finished run → ids earned by
// that run); persistence is per-device localStorage, same as streaks.

import type { LineupSlots, RunResult } from '../engine/types';

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

/** Badge ids this run earns (regardless of what was already unlocked). */
export function evaluateBadges(lineup: LineupSlots, run: RunResult): BadgeId[] {
  const players = Object.values(lineup).filter((p) => p != null);
  const won = run.outcome === 'invicto' || run.outcome === 'campeon';
  const finalGame = run.games.find((g) => g.stage === 'final');
  const earned: BadgeId[] = [];

  if (run.outcome === 'invicto') earned.push('invicto');
  if (won) earned.push('campeon');
  if (won && players.filter((p) => p.rating < 60).length >= 5) earned.push('matagigantes');
  if (won && players.every((p) => p.rating < 80)) earned.push('sin_estrellas');
  if (players.length === 12 && new Set(players.map((p) => p.edition)).size === 1) earned.push('una_sola_edicion');
  if (players.length === 12 && new Set(players.map((p) => p.country)).size === 12) earned.push('vuelta_al_mundo');
  if (EDITIONS.every((year) => players.some((p) => p.edition === year))) earned.push('seis_editiones');
  if (finalGame?.win && finalGame.oppScore === 0) earned.push('blanqueada_final');

  return earned;
}

/** Map of badge id → first-earned ISO date. */
export function earnedBadges(): Partial<Record<BadgeId, string>> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<BadgeId, string>>) : {};
  } catch {
    return {};
  }
}

export function earnedBadgeCount(): number {
  return Object.keys(earnedBadges()).length;
}

/** Persist this run's badges; returns only the ones earned for the first time. */
export function recordBadges(ids: BadgeId[]): BadgeId[] {
  const store = earnedBadges();
  const fresh = ids.filter((id) => !store[id]);
  if (fresh.length > 0) {
    for (const id of fresh) store[id] = new Date().toISOString();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      // storage is best-effort
    }
  }
  return fresh;
}
