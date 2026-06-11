// Engine domain types. EnginePlayer mirrors the records in public/data/players.json.

export type Slot = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';

export interface EnginePlayer {
  id: string;
  personKey: string;
  name: string;
  edition: number;
  country: string;
  positions: Slot[];
  rating: number;
  contact: number;
  power: number;
  speed: number;
  defense: number;
  clutch: number;
}

/** Edition year → country codes that played it (from editions.json). */
export type EditionTeams = Record<number, string[]>;

export interface Roll {
  country: string;
  edition: number;
}

export type Stage = 'pool-1' | 'pool-2' | 'pool-3' | 'pool-4' | 'qf' | 'sf' | 'final';

export type Outcome = 'invicto' | 'campeon' | 'subcampeon' | 'eliminated-sf' | 'eliminated-qf' | 'eliminated-pool';

export interface GameResult {
  stage: Stage;
  opponent: { country: string; rating: number };
  win: boolean;
  teamScore: number;
  oppScore: number;
  mercy: boolean;
  walkOff: boolean;
  flavorKey: string;
  flavorVariant: number;
}

export interface RunResult {
  teamRating: number;
  games: GameResult[];
  wins: number;
  losses: number;
  outcome: Outcome;
}
