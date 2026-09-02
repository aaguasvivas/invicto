// Engine domain types. EnginePlayer mirrors the records in public/data/players.json.

export type Slot = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'SP' | 'RP' | 'CL';

/** A (possibly partial) drafted lineup keyed by slot. */
export type LineupSlots = Partial<Record<Slot, EnginePlayer>>;

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
  /** display only: current club at the time of the edition */
  club?: string | null;
}

/** Edition year → country codes that played it (from editions.json). */
export type EditionTeams = Record<number, string[]>;

export interface Roll {
  country: string;
  edition: number;
}

export type Stage = 'pool-1' | 'pool-2' | 'pool-3' | 'pool-4' | 'qf' | 'sf' | 'final';

export type Outcome = 'invicto' | 'campeon' | 'subcampeon' | 'eliminated-sf' | 'eliminated-qf' | 'eliminated-pool';

export type HeroKind = 'slugger' | 'contact' | 'starter' | 'closer' | 'goatK' | 'goatBlown';

/** A player from YOUR lineup starring (or choking) in this game. */
export interface HeroMoment {
  slot: Slot;
  kind: HeroKind;
  /** stat-line parameters; meaning depends on kind (HRs, hits, IP, Ks …) */
  n1: number;
  n2: number;
}

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
  hero: HeroMoment | null;
}

export interface RunResult {
  teamRating: number;
  games: GameResult[];
  wins: number;
  losses: number;
  outcome: Outcome;
}
