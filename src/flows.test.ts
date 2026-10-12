// End-to-end flows: the real main.ts boots on the fake DOM (src/test/fakedom.ts)
// with the real roster data, every /api call failing (nothing reaches the
// Worker), and fake timers driving the roll spin and the sim reveal. A "reload"
// drops the page's timers and modules but keeps localStorage, like a phone
// reloading a background tab. These guard the wiring between screens, which
// the unit tests cannot see.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { canEditionReroll, POWERS, rollBase, rollCountryReroll } from './engine/draft';
import type { EditionTeams, EnginePlayer, Roll } from './engine/types';
import { dailyNumber, formatDayKey } from './game/state';
import en from './i18n/en.json';
import es from './i18n/es.json';
import ja from './i18n/ja.json';
import ko from './i18n/ko.json';
import { COUNTRY_ACCENTS } from './ui/accents';
import { installDom, installStorage, type FakeDom, type FakeElement, type StorageFault } from './test/fakedom';

const dataFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
const DATA: Record<string, unknown> = { 'players.json': dataFile('players.json'), 'editions.json': dataFile('editions.json') };
const PLAYERS = (DATA['players.json'] as { players: EnginePlayer[] }).players;
const TEAMS: EditionTeams = Object.fromEntries(
  (DATA['editions.json'] as { editions: { year: number; teams: { code: string }[] }[] }).editions.map((e) => [e.year, e.teams.map((c) => c.code)]),
);

let store: Map<string, string>;
let apiCalls: string[];
let page: FakeDom;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 11, 12, 0));
  store = new Map();
  apiCalls = [];
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const file = Object.keys(DATA).find((name) => url.endsWith(`/data/${name}`));
    if (file) return { ok: true, json: async () => DATA[file] };
    apiCalls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
    throw new TypeError('offline (test stub)');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage']) Reflect.deleteProperty(globalThis, name);
});

/** Load the page: a fresh DOM and fresh modules over the same localStorage. */
async function load(fault: StorageFault = 'none', languages?: string[]): Promise<void> {
  const now = Date.now();
  vi.clearAllTimers(); // the previous page's timers die with it (this also resets the fake clock)
  vi.setSystemTime(now);
  vi.resetModules();
  page = installDom(languages);
  installStorage(fault, store);
  await import('./main');
  await vi.advanceTimersByTimeAsync(0);
}

function find(selector: string, text: string): FakeElement {
  const el = [...page.app.querySelectorAll(selector), ...page.body.querySelectorAll(selector)].find((e) => e.textContent.includes(text));
  if (!el) throw new Error(`no ${selector} with "${text}"`);
  return el;
}

/** Tap a button by its label and let the async handlers (data load) settle. */
async function tap(label: string): Promise<void> {
  find('button', label).click();
  await vi.advanceTimersByTimeAsync(0);
}

async function goHome(): Promise<void> {
  find('a', en.result.home).click();
  await vi.advanceTimersByTimeAsync(0);
}

/** Settle each spin and draft the first legal player into the first offered slot. */
function draft(picks: number): void {
  for (let i = 0; i < picks; i++) {
    const card = page.app.querySelector('.roll-card');
    if (card?.classList.contains('spinning')) card.click();
    const row = page.app.querySelectorAll('button.player-row').find((b) => !b.classList.contains('taken') && !b.classList.contains('ineligible'));
    if (!row) throw new Error(`no legal pick in round ${i + 1}`);
    row.click();
    page.body.querySelector('.sheet-overlay')?.querySelector('button.slot-option')?.click();
  }
}

/** Skip the sim reveal (once the stray-tap guard is over) and land on the result screen. */
async function skipSim(): Promise<void> {
  const sim = page.app.querySelector('.sim-screen');
  if (!sim) throw new Error('not on the sim screen');
  await vi.advanceTimersByTimeAsync(400);
  sim.click();
  await vi.advanceTimersByTimeAsync(1000);
  expect(page.app.querySelector('.result-screen')).not.toBeNull();
}

/** The first local day (from 2026-10-11 on) whose daily deals a first roll that passes `test`. */
function dailyWhere(test: (first: Roll, seed: string) => boolean): { date: Date; first: Roll; seed: string } {
  for (let i = 0; i < 1000; i++) {
    const date = new Date(2026, 9, 11 + i, 12, 0);
    const seed = `daily-${formatDayKey(date)}`;
    const first = rollBase(seed, 0, TEAMS);
    if (test(first, seed)) return { date, first, seed };
  }
  throw new Error('no daily in range deals that roll');
}

const rosterOf = (roll: Roll) => PLAYERS.filter((p) => p.edition === roll.edition && p.country === roll.country);
const accent = () => (document.documentElement as unknown as FakeElement).style.getPropertyValue('--accent');
const toasts = () => page.body.querySelectorAll('.toast').map((el) => el.textContent);

/** The roster as shown: each position group with its rows in screen order. */
function rosterGroups(): { label: string; rows: { name: string; pickable: boolean; rating: number }[] }[] {
  const groups: ReturnType<typeof rosterGroups> = [];
  for (const el of page.app.querySelector('.roster')!.children) {
    if (el.classList.contains('pos-group-label')) groups.push({ label: el.textContent, rows: [] });
    else if (el.classList.contains('player-row')) {
      groups[groups.length - 1].rows.push({
        name: el.querySelector('b')!.textContent,
        pickable: !el.classList.contains('taken') && !el.classList.contains('ineligible'),
        rating: Number(el.querySelector('.rating-chip')?.textContent),
      });
    }
  }
  return groups;
}

const DAILY = `⭐ ${en.title.daily}`;
const dailyResult = (day: string) => (store.has(`invicto.daily.${day}`) ? JSON.parse(store.get(`invicto.daily.${day}`)!) : null);
const posts = () => apiCalls.filter((c) => c === 'POST /api/result').length;

describe('daily challenge', () => {
  test('the 12th pick is autosaved, so the snapshot holds the full lineup', async () => {
    await load();
    await tap(DAILY);
    draft(12);
    expect(page.app.querySelector('.sim-screen')).not.toBeNull();
    const snap = JSON.parse(store.get('invicto.run')!);
    expect(Object.keys(snap.lineup)).toHaveLength(12);
    expect(snap.scored).toBe(true);
  });

  test('a reload during the sim resumes the same scored run; a new daily after it is practice', async () => {
    await load();
    await tap(DAILY);
    draft(12);
    const committed = dailyResult('2026-10-11');
    expect(committed).not.toBeNull(); // committed when the lineup is complete, before the reveal
    await vi.advanceTimersByTimeAsync(2600); // a few cards have flipped

    await load(); // the phone reloads the tab
    expect(page.app.textContent).toContain(en.title.dailyPractice); // no fresh scored attempt on offer
    await tap(en.title.resume);
    await skipSim();
    expect(page.app.querySelector('.poster-record')!.textContent).toBe(committed.record);
    expect(page.app.textContent).not.toContain(en.result.practice);
    expect(posts()).toBe(1);
    expect(store.has('invicto.run')).toBe(false);

    await goHome();
    await tap(en.title.dailyPractice);
    expect(page.body.querySelector('.toast')?.textContent).toBe(en.draft.practiceNote);
    expect(page.body.querySelector('.toast')?.getAttribute('role')).toBe('status'); // read out, never in the way
    draft(12);
    await skipSim();
    expect(page.app.textContent).toContain(en.result.practice);
    expect(dailyResult('2026-10-11')).toEqual(committed);
    expect(posts()).toBe(1);
  });

  test('a run started at 23:59 and reloaded at 00:03 resumes and keeps the streak', async () => {
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59));
    store.set('invicto.lastDaily', '2026-10-10');
    store.set('invicto.streak', '5');
    await load();
    await tap(DAILY);
    draft(3);

    vi.setSystemTime(new Date(2026, 9, 12, 0, 3));
    await load();
    await tap(en.title.resume);
    expect(page.app.querySelector('.draft-screen')).not.toBeNull();
    draft(9);
    await skipSim();
    expect(dailyResult('2026-10-11')).not.toBeNull();
    expect(dailyResult('2026-10-12')).toBeNull();

    await goHome();
    expect(page.app.textContent).toContain(en.title.streak.replace('{n}', '6'));
    expect(page.app.textContent).toContain(`⭐ ${en.title.dailyNum.replace('{n}', String(dailyNumber('2026-10-12')))}`);
  });
});

describe('storage that fails', () => {
  test.each(['blocked', 'full'] as const)('with %s storage the title renders and a run reaches the result screen', async (fault) => {
    await load(fault);
    expect(page.app.querySelector('.title-screen')).not.toBeNull();
    await tap(`⚾ ${en.title.free}`);
    draft(12);
    await skipSim();
  });
});

describe('draft screen', () => {
  test('New country tapped mid-spin reveals nothing until the new card lands', async () => {
    const { date, first, seed } = dailyWhere((roll, s) => POWERS.includes(rollCountryReroll(s, 0, roll, TEAMS).country));
    const rerolled = rollCountryReroll(seed, 0, first, TEAMS).country;
    vi.setSystemTime(date);
    await load();
    const vibrate = vi.fn();
    Object.assign(navigator, { vibrate });
    await tap(DAILY);
    await vi.advanceTimersByTimeAsync(300); // the first roll is still spinning

    find('button', en.draft.rerollCountry).click();
    const card = page.app.querySelector('.roll-card')!;
    expect(accent()).toBe('var(--gold)');
    expect(vibrate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400); // the replaced card's own timer runs out
    expect(card.classList.contains('spinning')).toBe(true);
    expect(accent()).toBe('var(--gold)');
    expect(vibrate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300); // the new card lands
    expect(card.classList.contains('spinning')).toBe(false);
    expect(accent()).toBe(COUNTRY_ACCENTS[rerolled]);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  test('a tap on the spinning card still lands it at once', async () => {
    await load();
    await tap(DAILY);
    const card = page.app.querySelector('.roll-card')!;
    card.click();
    expect(card.classList.contains('spinning')).toBe(false);
    expect(page.app.querySelectorAll('button.player-row').length).toBeGreaterThan(0);
  });

  test('a one-edition country says so on the edition button instead of ×1', async () => {
    const { date, first } = dailyWhere((roll) => !canEditionReroll(roll, TEAMS));
    vi.setSystemTime(date);
    await load();
    await tap(DAILY);
    page.app.querySelector('.roll-card')!.click();
    const [country, edition] = page.app.querySelectorAll('button.reroll-btn');
    expect(country.textContent).toBe(`${en.draft.rerollCountry} ×1`);
    expect(edition.textContent).toBe(en.draft.oneEdition.replace('{year}', String(first.edition)));
    expect(edition.disabled).toBe(true);
  });

  test('players who fit an open slot lead the roster, best first, in every round', async () => {
    await load();
    await tap(DAILY);
    for (let round = 1; round <= 12; round++) {
      page.app.querySelector('.roll-card')!.click();
      const groups = rosterGroups();
      const fits = groups.map((g) => g.rows.some((r) => r.pickable));
      expect(fits, `round ${round}: groups with a fit come first`).toEqual([...fits].sort((a, b) => Number(b) - Number(a)));
      for (const g of groups) {
        const expected = [...g.rows].sort((a, b) => Number(b.pickable) - Number(a.pickable) || b.rating - a.rating);
        expect(g.rows, `round ${round}, ${g.label}`).toEqual(expected);
      }
      expect(groups[0].rows[0].pickable, `round ${round}: the first row is a legal pick`).toBe(true);
      draft(1);
    }
    expect(page.app.querySelector('.sim-screen')).not.toBeNull();
  });

  test.each([
    ['es', es],
    ['ja', ja],
    ['ko', ko],
  ])('in %s the edition label and the club notes are translated', async (lang, table) => {
    const { date, first } = dailyWhere((roll) => {
      const clubs = rosterOf(roll).map((p) => p.club);
      return clubs.some((c) => / \(minors\)$/.test(c ?? '')) && clubs.includes('Free agent');
    });
    vi.setSystemTime(date);
    await load('none', [lang]);
    await tap(table.title.daily);
    await vi.advanceTimersByTimeAsync(140); // two spin frames
    const editionEl = page.app.querySelector('.roll-edition')!;
    const [before, after] = table.draft.edition.split('{year}');
    expect(editionEl.textContent.startsWith(before) && editionEl.textContent.endsWith(after)).toBe(true);

    page.app.querySelector('.roll-card')!.click();
    expect(editionEl.textContent).toBe(table.draft.edition.replace('{year}', String(first.edition)));
    const minors = rosterOf(first).find((p) => / \(minors\)$/.test(p.club ?? ''))!;
    const clubLine = (name: string) => page.app.querySelectorAll('button.player-row').find((r) => r.querySelector('b')!.textContent === name)!.querySelector('span.player-name')!.querySelector('span')!.textContent;
    expect(clubLine(minors.name)).toBe(table.draft.minors.replace('{club}', minors.club!.replace(/ \(minors\)$/, '')));
    const freeAgent = rosterOf(first).find((p) => p.club === 'Free agent')!;
    expect(clubLine(freeAgent.name)).toBe(table.draft.freeAgent);
    expect(page.app.textContent).not.toContain('(minors)');
    expect(page.app.textContent).not.toContain('Free agent');
  });

  test.each([
    ['es', es],
    ['ja', ja],
    ['ko', ko],
  ])('in %s a Japanese farm club is noted in the language too', async (lang, table) => {
    const isFarm = (club?: string | null) => / \(farm\)$/.test(club ?? '');
    const { date, first } = dailyWhere((roll) => rosterOf(roll).some((p) => isFarm(p.club)));
    vi.setSystemTime(date);
    await load('none', [lang]);
    await tap(table.title.daily);
    page.app.querySelector('.roll-card')!.click();
    const farm = rosterOf(first).find((p) => isFarm(p.club))!;
    const row = page.app.querySelectorAll('button.player-row').find((r) => r.querySelector('b')!.textContent === farm.name)!;
    expect(row.querySelector('span.player-name')!.querySelector('span')!.textContent).toBe(table.draft.farm.replace('{club}', farm.club!.replace(/ \(farm\)$/, '')));
  });
});

describe('sim screen', () => {
  test('a second tap from the last pick does not skip the reveal', async () => {
    await load();
    await tap(DAILY);
    draft(12);
    const sim = page.app.querySelector('.sim-screen')!;
    await vi.advanceTimersByTimeAsync(150); // a double tap's second click lands on the new screen
    sim.click();
    expect(page.app.querySelectorAll('.game-card.reveal')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250); // 400 ms in: taps skip again
    sim.click();
    expect(page.app.querySelectorAll('.game-card.reveal').length).toBeGreaterThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.app.querySelector('.result-screen')).not.toBeNull();
  });
});

describe('result screen', () => {
  afterEach(() => {
    vi.doUnmock('./ui/poster');
  });

  test('a second tap on Share while the share sheet is open does nothing', async () => {
    // No canvas here: the poster is not drawn, only shared.
    vi.doMock('./ui/poster', () => ({ ensurePosterFonts: async () => {}, drawSharePoster: () => {} }));
    let closeSheet = () => {};
    let sheetOpen = false;
    const share = vi.fn(() => {
      // Web Share: a second share() while the sheet is open rejects with InvalidStateError.
      if (sheetOpen) return Promise.reject(new DOMException('An earlier share has not yet completed.', 'InvalidStateError'));
      sheetOpen = true;
      return new Promise<void>((resolve) => {
        closeSheet = () => {
          sheetOpen = false;
          resolve();
        };
      });
    });
    const write = vi.fn(async () => {});
    vi.stubGlobal('File', class { constructor(readonly parts: unknown[], readonly name: string) {} });
    vi.stubGlobal('ClipboardItem', class { constructor(readonly items: unknown) {} });
    await load();
    Object.assign(navigator, { share, canShare: () => true, clipboard: { write, writeText: vi.fn(async () => {}) } });
    await tap(DAILY);
    draft(12);
    await skipSim();

    const button = find('button', en.result.share);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(share).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(toasts()).not.toContain(en.result.copied);
    expect(button.disabled).toBe(true);

    closeSheet();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.disabled).toBe(false);
    expect(toasts()).not.toContain(en.result.copied);
    expect(toasts()).not.toContain(en.result.shareFailed);
  });
});
