// The share card and the poster footer name the run the way it was dealt: the
// challenge number and date of its day (never the clock at the finish), a
// practice replay marked as practice, and Hard Mode in words.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installDom, installStorage } from '../test/fakedom';
import type { ShareContext } from './share';

let share: typeof import('./share');

/** A fresh page in this browser language, and the share module it loads. */
async function page(lang = 'en-US'): Promise<void> {
  vi.resetModules();
  installDom([lang]);
  installStorage();
  share = await import('./share');
}

beforeEach(async () => {
  await page();
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage']) Reflect.deleteProperty(globalThis, name);
});

function ctx(over: Partial<ShareContext> = {}): ShareContext {
  return {
    dailyNum: 123,
    practice: false,
    hard: false,
    streak: 0,
    tierLine: 'Runner-up 5-2 🥈',
    gameFlags: [
      { flag: '🇮🇹', win: true },
      { flag: '🇧🇷', win: true },
      { flag: '🇰🇷', win: false },
      { flag: '🇨🇴', win: true },
      { flag: '🇯🇵', win: true },
      { flag: '🇺🇸', win: true },
      { flag: '🇩🇴', win: false },
    ],
    ...over,
  };
}

const header = (card: string) => card.split('\n')[0];

describe('emojiCard header', () => {
  test('a scored daily names its challenge', () => {
    expect(header(share.emojiCard(ctx()))).toBe('INVICTO #123 ⚾');
  });

  test('a scored daily carries the streak from 2 days on', () => {
    expect(header(share.emojiCard(ctx({ streak: 13 })))).toBe('INVICTO #123 🔥13 ⚾');
    expect(header(share.emojiCard(ctx({ streak: 1 })))).toBe('INVICTO #123 ⚾');
  });

  test('a practice replay says so and never carries a streak', () => {
    const card = share.emojiCard(ctx({ practice: true, streak: 13 }));
    expect(card.startsWith('INVICTO #123 (practice)')).toBe(true);
    expect(card).not.toContain('🔥');
  });

  test('practice reads naturally in every language', async () => {
    const want: Record<string, string> = { 'es-DO': '(práctica)', 'ja-JP': '(練習)', 'ko-KR': '(연습)' };
    for (const [lang, tag] of Object.entries(want)) {
      await page(lang);
      expect(header(share.emojiCard(ctx({ practice: true })))).toBe(`INVICTO #123 ${tag} ⚾`);
    }
  });

  test('Hard Mode is named in words, not a bare 🔥', () => {
    expect(header(share.emojiCard(ctx({ dailyNum: null, hard: true })))).toBe('INVICTO · Hard Mode 🔥 ⚾');
  });

  test('free play has no number', () => {
    expect(header(share.emojiCard(ctx({ dailyNum: null })))).toBe('INVICTO ⚾');
  });

});

describe('the challenge in the card', () => {
  test('the card ends with the dare and the link that answers it', () => {
    const link = share.challengeUrl('free-mg5x2k7q-8f3k1z.ju3a050607');
    expect(link).toBe('https://invictobaseball.com/en/#r=free-mg5x2k7q-8f3k1z.ju3a050607');
    expect(share.emojiCard(ctx(), 'Top 3% today', link).split('\n').slice(-3)).toEqual([
      'Top 3% today',
      'Can you beat me? Same rolls, same dice 👇',
      link,
    ]);
  });

  test('Spanish links live at the root', async () => {
    await page('es-DO');
    expect(share.challengeUrl('x')).toBe('https://invictobaseball.com/#r=x');
  });

  test('without a link the card names no site and dares nobody', () => {
    const card = share.emojiCard(ctx(), null, null);
    expect(card.split('\n').at(-1)).toBe('Runner-up 5-2 🥈');
    expect(card).not.toMatch(/invictobaseball|👇/);
  });
});

describe('posterFooter', () => {
  test('dates a run by the day it was dealt, not the clock at the finish', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 0, 5)); // finished 5 minutes past midnight
    expect(share.posterFooter('2026-10-10', 122, false)).toBe('invictobaseball.com/en  ·  Oct 10, 2026  ·  #122');
  });

  test('shows the domain without a trailing slash', async () => {
    expect(share.posterFooter('2026-10-10', null, false)).toBe('invictobaseball.com/en  ·  Oct 10, 2026');
    await page('es-DO');
    expect(share.posterFooter('2026-10-10', null, false)).toBe('invictobaseball.com  ·  10 oct 2026');
  });

  test('marks a practice replay next to its number', () => {
    expect(share.posterFooter('2026-10-10', 122, true)).toBe('invictobaseball.com/en  ·  Oct 10, 2026  ·  #122 (practice)');
  });
});
