// Factories for engine tests. Not shipped.
import type { EnginePlayer, Slot } from './types';

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

/** A 9-man lineup whose five category means equal the given values. */
export function lineupWithMeans(
  contact: number,
  power: number,
  speed: number,
  defense: number,
  clutch: number,
): EnginePlayer[] {
  const slots: Slot[][] = [['C'], ['1B'], ['2B'], ['3B'], ['SS'], ['LF'], ['CF'], ['RF'], ['DH']];
  return slots.map((positions) =>
    makePlayer({ positions, contact, power, speed, defense, clutch, rating: Math.round((contact + power) / 2) }),
  );
}
