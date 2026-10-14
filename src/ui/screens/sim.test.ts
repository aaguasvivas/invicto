// The star line under a game card. The engine picks a closer star for any close
// win, walk-offs included, and deals 6 to 8 innings to a starter even when the
// mercy rule ended the game after 7. heroLine corrects both at display time, so
// the seeded simulation never changes.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { makePlayer } from '../../engine/test-helpers';
import type { GameResult, HeroMoment, LineupSlots, RunResult, Stage } from '../../engine/types';
import type { Rival } from '../../game/challenge';
import type { GameData } from '../../game/data';
import { installDom, installStorage, pressKey, type FakeDom, type FakeElement } from '../../test/fakedom';

afterEach(() => {
  vi.useRealTimers();
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'scrollBy', 'innerHeight', 'matchMedia', 'navigator', 'localStorage']) {
    Reflect.deleteProperty(globalThis, name);
  }
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

describe('splitEmojiTail', () => {
  test('splits off the last word and a trailing emoji, so they wrap as one', async () => {
    vi.resetModules();
    installDom(['en-US']);
    installStorage();
    const { splitEmojiTail } = await import('./sim');
    expect(splitEmojiTail('Walked off: 3-2 💔')).toEqual(['Walked off: ', '3-2 💔']);
    expect(splitEmojiTail('Cruel ending: 3-2 🗡️')).toEqual(['Cruel ending: ', '3-2 🗡️']); // with its variation selector
    expect(splitEmojiTail('Ugly but it counts: 3-2 😮‍💨')).toEqual(['Ugly but it counts: ', '3-2 😮‍💨']); // a joined sequence
    expect(splitEmojiTail('Hammer 🔨')).toEqual(['', 'Hammer 🔨']);
    expect(splitEmojiTail('No emoji at the end 🔥 here')).toEqual(['No emoji at the end 🔥 here', '']);
    expect(splitEmojiTail('🔥')).toEqual(['🔥', '']);
  });

  test('in Japanese, where every character is a break point, the tail stays short so the line still wraps', async () => {
    vi.resetModules();
    installDom(['ja-JP']);
    installStorage();
    const { splitEmojiTail } = await import('./sim');
    expect(splitEmojiTail('ドミニカ共和国にリズムを与えなかった：14-5 🎺')).toEqual(['ドミニカ共和国にリズムを与えなかった', '：14-5 🎺']);
    expect(splitEmojiTail('歴史的大勝：14-5。ドミニカ共和国は帰りのバスへ 🚌')).toEqual(['歴史的大勝：14-5。ドミニカ共和国は帰りのバス', 'へ 🚌']);
    expect(splitEmojiTail('サヨナラ負け 💔')).toEqual(['サヨナラ負', 'け 💔']);
  });

  test('in Korean, which spaces its words, the tail is the last word', async () => {
    vi.resetModules();
    installDom(['ko-KR']);
    installStorage();
    const { splitEmojiTail } = await import('./sim');
    expect(splitEmojiTail('역사적인 대승: 14-5. 도미니카 공화국 벤치는 집에 가고 싶었다 🚌')).toEqual(['역사적인 대승: 14-5. 도미니카 공화국 벤치는 집에 가고 ', '싶었다 🚌']);
    expect(splitEmojiTail('도미니카 공화국 벤치는 끝내 리듬을 못 찾았다: 14-5 🎺')).toEqual(['도미니카 공화국 벤치는 끝내 리듬을 못 찾았다: ', '14-5 🎺']);
  });
});

// ---------------------------------------------------------------------------
// The screen itself, on fake timers. A 7-0 run reveals at 500 ms (pool 1), then
// 600 ms apart through pool 4 (2300), the QF at 3050, the 5-0 soft beat at 4000,
// the SF at 4400, the 6-0 gold beat at 5700 and the final at 8100.

const STAGES: Stage[] = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'qf', 'sf', 'final'];
const DATA = { countries: new Map([['JPN', { code: 'JPN', nameEn: 'Japan', nameEs: 'Japón', flag: '🇯🇵' }]]) } as unknown as GameData;
const ALL_WINS = [true, true, true, true, true, true, true];
const OUT_IN_QF = [true, true, true, false, false];

/** A run with these results, stage by stage (the engine deals no game after an elimination). */
function runOf(marks: boolean[]): RunResult {
  const games = marks.map((win, i) =>
    game(closer, { stage: STAGES[i], win, teamScore: win ? 5 : 2, oppScore: win ? 2 : 5, flavorKey: win ? 'win-close' : 'loss-close' }),
  );
  const wins = marks.filter(Boolean).length;
  return { teamRating: 80, games, wins, losses: marks.length - wins, outcome: 'campeon' };
}

interface Sim {
  page: FakeDom;
  done: ReturnType<typeof vi.fn>;
  card(stage: Stage): FakeElement;
  bracket: FakeElement;
  record: FakeElement;
}

async function startSim(marks: boolean[]): Promise<Sim> {
  vi.useFakeTimers();
  vi.resetModules();
  const page = installDom(['en-US']);
  installStorage();
  const { renderSim } = await import('./sim');
  const done = vi.fn();
  renderSim(page.app as unknown as HTMLElement, runOf(marks), DATA, lineup, done);
  const cards = page.app.querySelectorAll('.game-card');
  return {
    page,
    done,
    card: (stage) => cards[STAGES.indexOf(stage)],
    bracket: page.app.querySelector('.bracket')!,
    record: page.app.querySelector('.sim-record')!,
  };
}

const revealed = (sim: Sim) => sim.page.app.querySelectorAll('.game-card').filter((c) => c.classList.contains('reveal')).length;

describe('sim layout', () => {
  test('pool play and the knockout are two columns, in bracket order', async () => {
    const sim = await startSim(ALL_WINS);
    const [pool, ko] = sim.bracket.children;
    expect(sim.bracket.children.map((c) => c.className)).toEqual(['bracket-col pool', 'bracket-col ko']);
    expect(pool.querySelectorAll('.game-card')).toHaveLength(4);
    expect(ko.querySelectorAll('.game-card')).toHaveLength(3);
    expect(ko.querySelectorAll('.bracket-section').map((s) => s.textContent)).toEqual(['Quarterfinal', 'Semifinal', 'THE FINAL']);
  });

  test('the record and the stage label share one sticky head', async () => {
    const sim = await startSim(ALL_WINS);
    const head = sim.page.app.querySelector('.sim-head')!;
    expect(head.children.map((c) => c.className)).toEqual(['sim-record', 'sim-stage-label']);
  });

  test("a revealed card's flavor line keeps its last word and trailing emoji on one line", async () => {
    const sim = await startSim(ALL_WINS);
    await vi.advanceTimersByTimeAsync(500);
    const line = sim.card('pool-1').querySelector('.game-flavor')!;
    expect(line.textContent).toBe('Ugly but it counts: 5-2 😮‍💨');
    expect(line.querySelector('span.tail')!.textContent).toBe('5-2 😮‍💨');
  });

  test("a revealed card's score row keeps each team's name and score in one block", async () => {
    const sim = await startSim(ALL_WINS);
    await vi.advanceTimersByTimeAsync(500);
    const teams = sim.card('pool-1').querySelector('.game-score')!.querySelectorAll('.team');
    expect(teams.map((s) => s.textContent)).toEqual(['Your Team 5', 'Japan 2']);
  });
});

describe('skipping the reveal', () => {
  test('the skip hint is a real button, and clicking it skips', async () => {
    const sim = await startSim(ALL_WINS);
    const button = sim.page.app.querySelector('.skip-hint')!;
    expect(button.tagName).toBe('button');
    expect(button.type).toBe('button');
    await vi.advanceTimersByTimeAsync(400);
    button.click();
    expect(revealed(sim)).toBe(7);
    await vi.advanceTimersByTimeAsync(900);
    expect(sim.done).toHaveBeenCalledTimes(1);
  });

  test.each(['Enter', ' ', 'Escape'])('%j skips, once the stray-tap guard is over', async (key) => {
    const sim = await startSim(ALL_WINS);
    const body = document.body as unknown as FakeElement;
    await vi.advanceTimersByTimeAsync(100); // the key that made the last pick, still down
    body.dispatch('keydown', key);
    expect(revealed(sim)).toBe(0);

    await vi.advanceTimersByTimeAsync(300);
    const press = body.dispatch('keydown', key);
    expect(press.defaultPrevented).toBe(true); // Space would scroll the page, Enter would click a focused button
    expect(revealed(sim)).toBe(7);
    pressKey(key); // a second press while the result loads
    await vi.advanceTimersByTimeAsync(900);
    expect(sim.done).toHaveBeenCalledTimes(1);
  });

  test('other keys do not skip', async () => {
    const sim = await startSim(ALL_WINS);
    await vi.advanceTimersByTimeAsync(400);
    for (const key of ['Tab', 'ArrowDown', 'a']) pressKey(key);
    expect(revealed(sim)).toBe(0);
  });

  test('the finished screen leaves no key, wheel or touch listener on the page', async () => {
    const sim = await startSim(ALL_WINS);
    await vi.runAllTimersAsync();
    expect(sim.done).toHaveBeenCalledTimes(1);
    const root = document.documentElement as unknown as FakeElement;
    for (const type of ['keydown', 'wheel', 'touchmove']) expect(root.listenerCount(type), type).toBe(0);
  });
});

describe('after an elimination', () => {
  test('the cards the run never reached turn to ghosts', async () => {
    const sim = await startSim(OUT_IN_QF);
    await vi.advanceTimersByTimeAsync(3050); // the QF loss
    expect(sim.card('sf').classList.contains('pending')).toBe(true);
    await vi.advanceTimersByTimeAsync(600); // the closing pause
    for (const stage of ['sf', 'final'] as const) {
      expect(sim.card(stage).classList.contains('unreached'), stage).toBe(true);
      expect(sim.card(stage).classList.contains('pending'), stage).toBe(false);
    }
    expect(sim.page.app.querySelectorAll('.game-card').filter((c) => c.classList.contains('unreached'))).toHaveLength(2);
  });

  test('a skip marks them too', async () => {
    const sim = await startSim(OUT_IN_QF);
    await vi.advanceTimersByTimeAsync(400);
    sim.page.app.querySelector('.sim-screen')!.click();
    expect(sim.page.app.querySelectorAll('.game-card').filter((c) => c.classList.contains('unreached'))).toHaveLength(2);
  });

  test("a champion's bracket has none", async () => {
    const sim = await startSim(ALL_WINS);
    await vi.runAllTimersAsync();
    expect(sim.page.app.querySelectorAll('.game-card').filter((c) => c.classList.contains('unreached'))).toHaveLength(0);
  });
});

describe('the 6-0 beat', () => {
  test('dims the bracket, lifts the record, buzzes a heartbeat and holds for 2.4 s', async () => {
    const sim = await startSim(ALL_WINS);
    const vibrate = vi.spyOn(navigator, 'vibrate');
    await vi.advanceTimersByTimeAsync(5700);
    const beat = sim.page.app.querySelector('.beat-line')!;
    expect(beat.textContent).toBe('FOR THE PERFECT RUN…');
    expect(beat.parentNode!.childNodes[beat.parentNode!.childNodes.indexOf(beat) + 1]).toBe(sim.card('final'));
    expect(sim.bracket.classList.contains('final-beat')).toBe(true);
    expect(sim.record.classList.contains('beat')).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith([0, 90, 200, 90]);

    await vi.advanceTimersByTimeAsync(2399);
    expect(sim.card('final').classList.contains('pending')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(sim.card('final').classList.contains('pending')).toBe(false);
    expect(sim.bracket.classList.contains('final-beat')).toBe(false);
    expect(sim.record.classList.contains('beat')).toBe(false);
    expect(sim.page.app.querySelector('.beat-line')).toBeNull();
  });

  test('a skip mid-beat clears it', async () => {
    const sim = await startSim(ALL_WINS);
    await vi.advanceTimersByTimeAsync(6000);
    sim.page.app.querySelector('.sim-screen')!.click();
    expect(revealed(sim)).toBe(7);
    expect(sim.bracket.classList.contains('final-beat')).toBe(false);
    expect(sim.record.classList.contains('beat')).toBe(false);
  });
});

describe('follow-scroll', () => {
  const g = globalThis as Record<string, unknown>;

  /** A 667 px phone with a 64 px sticky head; every card sits in the middle of the frame unless a test moves it. */
  function phone(sim: Sim): ReturnType<typeof vi.fn> {
    const scrollBy = vi.fn();
    g.scrollBy = scrollBy;
    g.innerHeight = 667;
    sim.page.app.querySelector('.sim-head')!.rect = { top: 0, bottom: 64, height: 64 };
    for (const stage of STAGES) place(sim, stage, 300);
    return scrollBy;
  }
  const place = (sim: Sim, stage: Stage, top: number) => {
    sim.card(stage).rect = { top, bottom: top + 56, height: 56 };
  };
  /** Where a scroll puts a card's middle: the middle of the space between the head and the bottom of the frame. */
  const centering = (top: number) => top + 28 - (64 + 667) / 2;

  test('a card below the fold glides to the middle of the frame before it flips', async () => {
    const sim = await startSim(ALL_WINS);
    const scrollBy = phone(sim);
    place(sim, 'qf', 700);
    await vi.advanceTimersByTimeAsync(2300); // pool 4 flips; the QF is next
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: centering(700), behavior: 'smooth' });
    expect(sim.card('qf').classList.contains('pending')).toBe(true);
  });

  test('a card hidden under the sticky record comes back into view', async () => {
    const sim = await startSim(ALL_WINS);
    const scrollBy = phone(sim);
    place(sim, 'pool-3', 20);
    await vi.advanceTimersByTimeAsync(1100);
    expect(scrollBy).toHaveBeenCalledWith({ top: centering(20), behavior: 'smooth' });
  });

  test('a card just above the fold moves too: its reveal adds lines under it', async () => {
    const sim = await startSim(ALL_WINS);
    const scrollBy = phone(sim);
    place(sim, 'pool-2', 667 - 56 - 20);
    await vi.advanceTimersByTimeAsync(500);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  test('cards already in frame do not move the page', async () => {
    const sim = await startSim(ALL_WINS);
    const scrollBy = phone(sim);
    await vi.runAllTimersAsync();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test('the 6-0 beat frames the final card under its beat line', async () => {
    const sim = await startSim(ALL_WINS);
    const scrollBy = phone(sim);
    await vi.advanceTimersByTimeAsync(4400); // the SF flips with the final in frame
    expect(scrollBy).not.toHaveBeenCalled();
    place(sim, 'final', 640); // the beat line pushes it down
    await vi.advanceTimersByTimeAsync(1300);
    expect(sim.page.app.querySelector('.beat-line')).not.toBeNull();
    expect(scrollBy).toHaveBeenCalledWith({ top: centering(640), behavior: 'smooth' });
  });

  test('with reduced motion the page jumps instead of gliding', async () => {
    const sim = await startSim(ALL_WINS);
    const scrollBy = phone(sim);
    g.matchMedia = (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' });
    place(sim, 'qf', 700);
    await vi.advanceTimersByTimeAsync(2300);
    expect(scrollBy).toHaveBeenCalledWith({ top: centering(700), behavior: 'auto' });
  });

  test.each(['wheel', 'touchmove'])('the first %s hands the scroll back to the player', async (type) => {
    const sim = await startSim(ALL_WINS);
    const scrollBy = phone(sim);
    await vi.advanceTimersByTimeAsync(1000);
    sim.card('pool-2').dispatch(type);
    for (const stage of STAGES) place(sim, stage, 900);
    await vi.runAllTimersAsync();
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
