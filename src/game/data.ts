// Loads the static JSON produced by the data pipeline and indexes it for play.

import type { EditionTeams, EnginePlayer } from '../engine/types';

export interface Country {
  code: string;
  nameEn: string;
  nameEs: string;
  flag: string;
}

export interface GameData {
  players: EnginePlayer[];
  byTeam: Map<string, EnginePlayer[]>; // `${edition}-${country}`
  editionTeams: EditionTeams;
  countries: Map<string, Country>;
}

let cached: GameData | null = null;

export async function loadData(): Promise<GameData> {
  if (cached) return cached;
  const [playersRes, editionsRes] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}data/players.json`),
    fetch(`${import.meta.env.BASE_URL}data/editions.json`),
  ]);
  if (!playersRes.ok || !editionsRes.ok) throw new Error('failed to load game data');
  const playersJson = (await playersRes.json()) as { players: EnginePlayer[] };
  const editionsJson = (await editionsRes.json()) as {
    editions: { year: number; teams: { code: string }[] }[];
    countries: Country[];
  };

  const byTeam = new Map<string, EnginePlayer[]>();
  for (const p of playersJson.players) {
    const key = `${p.edition}-${p.country}`;
    (byTeam.get(key) ?? byTeam.set(key, []).get(key)!).push(p);
  }
  const editionTeams: EditionTeams = {};
  for (const e of editionsJson.editions) editionTeams[e.year] = e.teams.map((team) => team.code);

  cached = {
    players: playersJson.players,
    byTeam,
    editionTeams,
    countries: new Map(editionsJson.countries.map((c) => [c.code, c])),
  };
  return cached;
}

export function roster(data: GameData, edition: number, country: string): EnginePlayer[] {
  return data.byTeam.get(`${edition}-${country}`) ?? [];
}

/** What the rosters hold, for the title's depth line: real people (one per personKey), countries and Classics. */
export function depthOf(players: EnginePlayer[]): { players: number; countries: number; editions: number } {
  const count = (pick: (p: EnginePlayer) => string | number) => new Set(players.map(pick)).size;
  return { players: count((p) => p.personKey), countries: count((p) => p.country), editions: count((p) => p.edition) };
}
