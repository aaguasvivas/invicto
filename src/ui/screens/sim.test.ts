// The star line under a game card. The engine picks a closer star for any close
// win, walk-offs included, and deals 6 to 8 innings to a starter even when the
// mercy rule ended the game after 7. heroLine corrects both at display time, so
// the seeded simulation never changes.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { makePlayer } from '../../engine/test-helpers';
import type { GameResult, HeroMoment, LineupSlots } from '../../engine/types';
import type { Rival } from '../../game/challenge';
import { installDom, installStorage } from '../../test/fakedom';

afterEach(() => {
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage']) Reflect.deleteProperty(globalThis, name);
});

/** heroLine on a fresh page whose browser speaks this language. */
async function heroLineIn(browserLang: string) {
  vi.resetModules();
  installDom([browserLang]);
  installStorage();
  return (await import('./sim')).heroLine;
}

const lineup: LineupSlots = {
  SP: makePlayer({ name: 'Yu Darvish', positions: ['SP', 'RP'] }),
  CL: makePlayer({ name: 'Edwin Díaz', positions: ['CL', 'RP'] }),
};

function game(hero: HeroMoment, over: Partial<GameResult> = {}): GameResult {
  return {
    stage: 'pool-1',
    opponent: { country: 'JPN', rating: 70 },
    win: true,
    teamScore: 4,
    oppScore: 3,
    mercy: false,
    walkOff: false,
    flavorKey: 'win-close',
    flavorVariant: 0,
    hero,
    ...over,
  };
}

const closer: HeroMoment = { slot: 'CL', kind: 'closer', n1: 2, n2: 0 };
const SAVE_WORDS = /save|salvamento|セーブ|세이브/i;

describe('heroLine', () => {
  test('a closer in a walk-off win gets the win, never a save, in every language', async () => {
    for (const lang of ['es-ES', 'en-US', 'ja-JP', 'ko-KR']) {
      const heroLine = await heroLineIn(lang);
      const line = heroLine(game(closer, { walkOff: true, flavorKey: 'win-walkoff' }), lineup) ?? '';
      expect(line, lang).toContain('Edwin Díaz');
      expect(line, lang).toContain('2');
      expect(line, lang).not.toMatch(SAVE_WORDS);
    }
  });

  test('a closer who protects a close lead keeps the save', async () => {
    const heroLine = await heroLineIn('en-US');
    expect(heroLine(game(closer), lineup)).toBe('⭐ Edwin Díaz: the save, 2 K in the 9th');
  });

  test('a mercy game ends after 7, so the starter line stops at 7 innings', async () => {
    const heroLine = await heroLineIn('en-US');
    const starter: HeroMoment = { slot: 'SP', kind: 'starter', n1: 8, n2: 11 };
    const mercy = { mercy: true, teamScore: 10, oppScore: 0, flavorKey: 'win-mercy' };
    expect(heroLine(game(starter, mercy), lineup)).toBe('⭐ Yu Darvish: 7 scoreless innings, 11 strikeouts');
    expect(heroLine(game(starter, { teamScore: 3, oppScore: 0, flavorKey: 'win-shutout' }), lineup)).toBe(
      '⭐ Yu Darvish: 8 scoreless innings, 11 strikeouts',
    );
  });

  test('no line when the star is not in the lineup', async () => {
    const heroLine = await heroLineIn('en-US');
    expect(heroLine(game(closer), { SP: lineup.SP })).toBeNull();
    expect(heroLine(game(closer, { hero: null }), lineup)).toBeNull();
  });
});

describe('rivalLine', () => {
  const STAGES = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'qf', 'sf', 'final'] as const;
  const rival = (over: Partial<Rival> = {}): Rival => ({
    code: 'x', name: 'Ana', seed: 'free-a-b', wins: [true, false, true, true, false], lineup: null, run: null, ...over,
  });

  test("a stage the rival never reached says so; a record-only rival shows the mark alone", async () => {
    vi.resetModules();
    installDom(['en-US']);
    installStorage();
    const { rivalLine } = await import('./sim');
    expect(rivalLine(rival(), 'pool-2', STAGES)).toBe('⚔️ Ana: ❌');
    expect(rivalLine(rival(), 'qf', STAGES)).toBe('⚔️ Ana: ❌');
    expect(rivalLine(rival(), 'sf', STAGES)).toBe('⚔️ Ana: did not get this far');
    expect(rivalLine(rival({ name: null }), 'final', STAGES)).toBe('⚔️ your rival: did not get this far');
  });

  test('with a replayed run, the score of their game at that stage', async () => {
    vi.resetModules();
    installDom(['es-DO']);
    installStorage();
    const { rivalLine } = await import('./sim');
    const games = rival().wins.map((win, i) => game(closer, { stage: STAGES[i], win, teamScore: win ? 7 : 2, oppScore: win ? 5 : 4 }));
    const run = { teamRating: 80, games, wins: 3, losses: 2, outcome: 'eliminated-qf' as const };
    expect(rivalLine(rival({ run, lineup: {} }), 'pool-1', STAGES)).toBe('⚔️ Ana: 7-5 ✅');
    expect(rivalLine(rival({ run, lineup: {} }), 'qf', STAGES)).toBe('⚔️ Ana: 2-4 ❌');
    expect(rivalLine(rival({ run, lineup: {} }), 'final', STAGES)).toBe('⚔️ Ana: no llegó');
  });
});
