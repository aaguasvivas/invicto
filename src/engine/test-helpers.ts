// Factories for engine tests. Not shipped.
import type { EnginePlayer, LineupSlots, Slot } from './types';

let counter = 0;

export function makePlayer(overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  counter++;
  return {
    id: `t-${counter}`,
    personKey: `person-${counter}`,
    name: `Test Player ${counter}`,
    edition: 2023,
    country: 'VEN',
    positions: ['1B'] as Slot[],
    rating: 70,
    contact: 70,
    power: 70,
    speed: 55,
    defense: 55,
    clutch: 70,
    ...overrides,
  };
}

/** A full 12-slot lineup: hitter category means as given, pitching = mean pitcher rating. */
export function lineupWithMeans(
  contact: number,
  power: number,
  speed: number,
  defense: number,
  clutch: number,
  pitching = 70,
): LineupSlots {
  const lineup: LineupSlots = {};
  const hitterSlots: Slot[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  for (const slot of hitterSlots) {
    lineup[slot] = makePlayer({ positions: [slot], contact, power, speed, defense, clutch, rating: Math.round((contact + power) / 2) });
  }
  lineup.SP = makePlayer({ positions: ['SP', 'RP'], rating: pitching, contact: 25, power: 25, speed: 30, defense: 45, clutch: pitching });
  lineup.RP = makePlayer({ positions: ['RP'], rating: pitching, contact: 25, power: 25, speed: 30, defense: 45, clutch: pitching });
  lineup.CL = makePlayer({ positions: ['RP', 'CL'], rating: pitching, contact: 25, power: 25, speed: 30, defense: 45, clutch: pitching });
  return lineup;
}
