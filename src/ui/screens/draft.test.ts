// The category bars in the draft tray: the six values over the drafted players
// only, the gate marked, the gate's value on each hitter row, and the one tip
// that explains it. Free and daily show them; Hard Mode shows none of it.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makePlayer } from '../../engine/test-helpers';
import { CATEGORIES, categoryRatings } from '../../engine/teamRating';
import type { EnginePlayer, LineupSlots } from '../../engine/types';
import type { GameData } from '../../game/data';
import type { Mode } from '../../game/state';
import en from '../../i18n/en.json';
import { installDom, installStorage, type FakeDom, type FakeElement, type StorageFault } from '../../test/fakedom';

const hitter = (name: string, positions: EnginePlayer['positions'], speed: number, over: Partial<EnginePlayer> = {}) =>
  makePlayer({ name, positions, contact: 80, power: 78, speed, defense: 70, clutch: 82, rating: 80, club: 'Leones del Caracas', ...over });

/** One team, so every roll deals it: three hitters and two pitchers with known numbers. */
const ROSTER: EnginePlayer[] = [
  hitter('Slow Catcher', ['C'], 40),
  hitter('Fast Shortstop', ['SS'], 95),
  hitter('Slower First', ['1B'], 30),
  makePlayer({ name: 'Ace Starter', positions: ['SP'], rating: 90, speed: 20 }),
  makePlayer({ name: 'Pen Arm', positions: ['RP'], rating: 70, speed: 20 }),
];

const DATA: GameData = {
  players: ROSTER,
  byTeam: new Map([['2023-VEN', ROSTER]]),
  editionTeams: { 2023: ['VEN'] },
  countries: new Map([['VEN', { code: 'VEN', nameEn: 'Venezuela', nameEs: 'Venezuela', flag: '🇻🇪' }]]),
};

let page: FakeDom;
let store: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  store = new Map();
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage', 'location', 'history']) Reflect.deleteProperty(globalThis, name);
});

/** A fresh English page over the same storage, on the draft of a new run in this mode. */
async function openDraft(mode: Mode, fault: StorageFault = 'none'): Promise<void> {
  vi.resetModules();
  page = installDom(['en-US']);
  installStorage(fault, store);
  const { renderDraft } = await import('./draft');
  const { newSession } = await import('../../game/session');
  renderDraft(page.app as unknown as HTMLElement, newSession(DATA, mode, false, `${mode}-test`), { onDone: () => {} });
  settle();
}

/** Stop the roll's spin, so the roster is drawn. */
function settle(): void {
  const card = page.app.querySelector('.roll-card');
  if (card?.classList.contains('spinning')) card.click();
}

function row(name: string): FakeElement {
  const el = page.app.querySelectorAll('button.player-row').find((b) => b.textContent.includes(name));
  if (!el) throw new Error(`no row for ${name}`);
  return el;
}

/** Draft a player into the first slot offered, and land the next roll. */
function draft(name: string): void {
  row(name).click();
  page.body.querySelector('dialog.sheet')?.querySelector('button.slot-option')?.click();
  settle();
}

const cells = () => page.app.querySelectorAll('.cat-cell');
const cellText = () => cells().map((c) => `${c.querySelector('.cat-label')?.textContent} ${c.querySelector('.cat-value')?.textContent}`);
const gateCells = () => cells().filter((c) => c.classList.contains('gate')).map((c) => c.querySelector('.cat-label')?.textContent);
const tag = (name: string) => row(name).querySelector('.player-tag');
const tip = () => page.app.querySelector('.toast');

describe('draftedCategories', () => {
  beforeEach(() => {
    // draft.ts loads the language table, which reads the browser's languages.
    vi.resetModules();
    installDom();
    installStorage();
  });

  test('a lineup with no hitter has no hitter values, and the gate is the lowest value it has', async () => {
    const { draftedCategories, draftGate } = await import('./draft');
    const lineup: LineupSlots = {
      SP: makePlayer({ positions: ['SP'], rating: 88, contact: 20, power: 20, speed: 30, defense: 40, clutch: 60 }),
      CL: makePlayer({ positions: ['CL'], rating: 74 }),
    };
    const values = draftedCategories(lineup);
    expect(values).toEqual({ contact: null, power: null, speed: null, defense: null, clutch: null, pitching: 81 });
    expect(draftGate(values)).toEqual({ category: 'pitching', value: 81 });
  });

  test('a lineup with no pitcher has no pitching value; the gate is the lowest hitter mean', async () => {
    const { draftedCategories, draftGate } = await import('./draft');
    const lineup: LineupSlots = {
      C: makePlayer({ positions: ['C'], contact: 70, power: 60, speed: 40, defense: 80, clutch: 66 }),
      SS: makePlayer({ positions: ['SS'], contact: 80, power: 50, speed: 70, defense: 90, clutch: 74 }),
    };
    const values = draftedCategories(lineup);
    expect(values).toEqual({ contact: 75, power: 55, speed: 55, defense: 85, clutch: 70, pitching: null });
    expect(draftGate(values)).toEqual({ category: 'power', value: 55 }); // a tie goes to the first category, as on the result card
  });

  test('an empty lineup has no values and no gate', async () => {
    const { draftedCategories, draftGate } = await import('./draft');
    const values = draftedCategories({});
    expect(CATEGORIES.map((c) => values[c])).toEqual([null, null, null, null, null, null]);
    expect(draftGate(values)).toBeNull();
  });

  test('once a hitter and a pitcher are in, the values are the engine\'s own', async () => {
    const { draftedCategories, draftGate } = await import('./draft');
    const lineup: LineupSlots = {
      CF: makePlayer({ positions: ['CF'], contact: 72, power: 64, speed: 91, defense: 85, clutch: 70 }),
      RP: makePlayer({ positions: ['RP'], rating: 61 }),
    };
    expect(draftedCategories(lineup)).toEqual(categoryRatings(lineup));
    expect(draftGate(draftedCategories(lineup))?.category).toBe('pitching');
  });
});

describe('the tray in free play', () => {
  test('before the first pick, six labelled cells show "-" and none is the gate', async () => {
    await openDraft('free');
    expect(page.app.querySelector('.cat-bars')?.getAttribute('aria-label')).toBe(en.draft.trayAria);
    expect(cellText()).toEqual(['CON -', 'POW -', 'SPD -', 'DEF -', 'CLU -', 'PIT -']);
    expect(gateCells()).toEqual([]);
    expect(page.app.querySelector('.player-tag')).toBeNull();
  });

  test('the first hitter fills the hitter cells, marks the lowest, and tags each hitter row with its value there', async () => {
    await openDraft('free');
    draft('Slow Catcher');
    expect(cellText()).toEqual(['CON 80', 'POW 78', 'SPD 40', 'DEF 70', 'CLU 82', 'PIT -']);
    expect(gateCells()).toEqual(['SPD']);
    // Above the team's value at the gate: green. At or below it: dim.
    expect(tag('Fast Shortstop')?.textContent).toBe(' · SPD 95');
    expect(tag('Fast Shortstop')?.classList.contains('up')).toBe(true);
    expect(tag('Slower First')?.textContent).toBe(' · SPD 30');
    expect(tag('Slower First')?.classList.contains('up')).toBe(false);
    // The club stays first on the line; pitchers and the drafted player get no tag.
    expect(row('Fast Shortstop').querySelector('.player-sub')?.textContent).toBe('Leones del Caracas · SPD 95');
    expect(tag('Ace Starter')).toBeNull();
    expect(tag('Pen Arm')).toBeNull();
    expect(tag('Slow Catcher')).toBeNull();
  });

  test('a pitcher first fills only the pitching cell, which is then the gate; no row is tagged', async () => {
    await openDraft('free');
    draft('Ace Starter');
    expect(cellText()).toEqual(['CON -', 'POW -', 'SPD -', 'DEF -', 'CLU -', 'PIT 90']);
    expect(gateCells()).toEqual(['PIT']);
    expect(page.app.querySelector('.player-tag')).toBeNull();
  });

  test('a row without a club shows the tag alone on its second line', async () => {
    ROSTER[1].club = null;
    try {
      await openDraft('free');
      draft('Slow Catcher');
      expect(row('Fast Shortstop').querySelector('.player-sub')?.textContent).toBe('SPD 95');
    } finally {
      ROSTER[1].club = 'Leones del Caracas';
    }
  });

  test('the daily shows the bars too', async () => {
    await openDraft('daily');
    expect(cells()).toHaveLength(6);
  });
});

describe('the gate tip', () => {
  test('shows once, over the tray, the first time a hitter is in, and remembers it', async () => {
    await openDraft('free');
    draft('Ace Starter'); // a lone pitching value: nothing to compare yet
    expect(tip()).toBeNull();
    expect(store.has('invicto.tipBars')).toBe(false);

    draft('Slow Catcher');
    expect(tip()?.textContent).toBe(en.draft.gateTip);
    expect(page.app.querySelector('.lineup-tray')?.querySelector('.toast')).not.toBeNull();
    expect(store.get('invicto.tipBars')).toBe('1');
    await vi.advanceTimersByTimeAsync(3000);
    expect(tip()).toBeNull();

    draft('Fast Shortstop');
    expect(tip()).toBeNull();

    await openDraft('free'); // a later run on this device
    draft('Slow Catcher');
    expect(tip()).toBeNull();
  });

  test('with storage that throws, it still shows only once per page', async () => {
    await openDraft('free', 'blocked');
    draft('Slow Catcher');
    expect(tip()?.textContent).toBe(en.draft.gateTip);
    draft('Fast Shortstop');
    expect(tip()).toBeNull();
  });
});

describe('Hard Mode', () => {
  test('no bars, no tags, no numbers and no tip', async () => {
    await openDraft('hard');
    expect(page.app.querySelector('.cat-bars')).toBeNull();
    draft('Slow Catcher');
    expect(page.app.querySelector('.cat-bars')).toBeNull();
    expect(page.app.querySelector('.player-tag')).toBeNull();
    expect(page.app.querySelector('.rating-chip')).toBeNull();
    expect(tip()).toBeNull();
    expect(store.has('invicto.tipBars')).toBe(false);
    // The second line is the club, as before the bars.
    expect(row('Fast Shortstop').querySelector('.player-sub')).toBeNull();
  });
});
