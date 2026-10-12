// End-to-end flows: the real main.ts boots on the fake DOM (src/test/fakedom.ts)
// with the real roster data, every /api call failing (nothing reaches the
// Worker), and fake timers driving the roll spin and the sim reveal. A "reload"
// drops the page's timers and modules but keeps localStorage, like a phone
// reloading a background tab. These guard the wiring between screens, which
// the unit tests cannot see.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { dailyNumber } from './game/state';
import en from './i18n/en.json';
import { installDom, installStorage, type FakeDom, type FakeElement, type StorageFault } from './test/fakedom';

const dataFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
const DATA: Record<string, unknown> = { 'players.json': dataFile('players.json'), 'editions.json': dataFile('editions.json') };

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
async function load(fault: StorageFault = 'none'): Promise<void> {
  const now = Date.now();
  vi.clearAllTimers(); // the previous page's timers die with it (this also resets the fake clock)
  vi.setSystemTime(now);
  vi.resetModules();
  page = installDom();
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

/** Skip the sim reveal and land on the result screen. */
async function skipSim(): Promise<void> {
  const sim = page.app.querySelector('.sim-screen');
  if (!sim) throw new Error('not on the sim screen');
  sim.click();
  await vi.advanceTimersByTimeAsync(1000);
  expect(page.app.querySelector('.result-screen')).not.toBeNull();
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
