// The star line under a game card. The engine picks a closer star for any close
// win, walk-offs included, and deals 6 to 8 innings to a starter even when the
// mercy rule ended the game after 7. heroLine corrects both at display time, so
// the seeded simulation never changes.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { makePlayer } from '../../engine/test-helpers';
import type { GameResult, HeroMoment, LineupSlots } from '../../engine/types';
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
