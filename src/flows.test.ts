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
import { activeElement, installDom, installStorage, pressKey, type FakeDom, type FakeElement, type StorageFault } from './test/fakedom';

const dataFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
const DATA: Record<string, unknown> = { 'players.json': dataFile('players.json'), 'editions.json': dataFile('editions.json') };
const PLAYERS = (DATA['players.json'] as { players: EnginePlayer[] }).players;
const TEAMS: EditionTeams = Object.fromEntries(
  (DATA['editions.json'] as { editions: { year: number; teams: { code: string }[] }[] }).editions.map((e) => [e.year, e.teams.map((c) => c.code)]),
);

let store: Map<string, string>;
let apiCalls: string[];
/** Canned answers by API path; any other /api call fails as if offline. */
let api: Record<string, unknown>;
let page: FakeDom;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 11, 12, 0));
  store = new Map();
  apiCalls = [];
  api = {};
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const file = Object.keys(DATA).find((name) => url.endsWith(`/data/${name}`));
    if (file) return { ok: true, json: async () => DATA[file] };
    const path = url.split('?')[0];
    apiCalls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path in api) return { ok: true, headers: { get: () => 'application/json' }, json: async () => api[path] };
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
    page.body.querySelector('dialog.sheet')?.querySelector('button.slot-option')?.click();
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
    const unlocked = Object.keys(JSON.parse(store.get('invicto.badges') ?? '{}'));
    expect(unlocked.length).toBeGreaterThan(0); // this lineup earns badges, so the replay has some to show
    await vi.advanceTimersByTimeAsync(2600); // a few cards have flipped

    await load(); // the phone reloads the tab
    // The day is committed, but its reveal is still to watch: nothing on the title gives the record away.
    const resume = find('button', en.title.watch);
    expect(resume.classList.contains('primary')).toBe(true);
    expect(resume.textContent).toContain(en.title.lineupSet);
    expect(resume.textContent).not.toContain(en.draft.round.replace('{n}', '12'));
    const card = page.app.querySelector('.daily-done')!;
    expect(card.textContent).toContain(en.title.donePending);
    expect(card.textContent).not.toContain(committed.record);
    expect(card.querySelectorAll('button')).toHaveLength(0); // a practice run now would throw the reveal away
    expect(page.app.querySelector('.meta-chips')).toBeNull();
    await tap(en.title.watch);
    await skipSim();
    expect(page.app.querySelector('.poster-record')!.textContent).toBe(committed.record);
    // Recorded at the commit, so no longer new, but this is the reveal they belong to.
    expect(page.app.querySelectorAll('.badge-chip')).toHaveLength(unlocked.length);
    expect(page.app.textContent).not.toContain(en.result.practice);
    expect(posts()).toBe(1);
    expect(store.has('invicto.run')).toBe(false);

    await goHome();
    await tap(en.title.practice);
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
    expect(page.app.querySelector('.streak-risk')!.textContent).toBe(en.title.streakRisk.replace('{n}', '6'));
    expect(page.app.textContent).toContain(`⭐ ${en.title.dailyNum.replace('{n}', String(dailyNumber('2026-10-12')))}`);
  });
});

describe('storage that fails', () => {
  test.each(['blocked', 'full'] as const)('with %s storage the title renders and a run reaches the result screen', async (fault) => {
    await load(fault);
    expect(page.app.querySelector('.title-screen')).not.toBeNull();
    await tap(en.title.free);
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

  test.each([
    ['es', es, 'invictobaseball.com'],
    ['en', en, 'invictobaseball.com/en/'],
    ['ja', ja, 'invictobaseball.com/ja/'],
    ['ko', ko, 'invictobaseball.com/ko/'],
  ])('in %s the copied card ends with the site in that language, and the poster footer starts with it, no trailing slash', async (lang, table, url) => {
    const copied: string[] = [];
    await load('none', [lang]);
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    await tap(table.title.free);
    draft(12);
    await skipSim();
    await tap(table.result.copy);
    expect(copied).toHaveLength(1);
    expect(copied[0].split('\n').at(-1)).toBe(url);
    expect(page.app.querySelector('.poster-foot')!.textContent.startsWith(`${url.replace(/\/$/, '')}  ·  `)).toBe(true);
  });
});

describe('CrazyGames portal build', () => {
  /** The CrazyGames SDK as the game sees it after init: the player's locale and the site's mute button. */
  function fakeSdk(locale: string, muteAudio = false) {
    const listeners: ((settings: { muteAudio: boolean; disableChat: boolean }) => void)[] = [];
    const settings = { muteAudio, disableChat: false };
    return {
      init: async () => {},
      user: { systemInfo: { countryCode: 'US', locale } },
      game: {
        settings,
        addSettingsChangeListener: (fn: (typeof listeners)[number]) => void listeners.push(fn),
        removeSettingsChangeListener: () => {},
        gameplayStart: () => {},
        gameplayStop: () => {},
        loadingStart: () => {},
        loadingStop: () => {},
        happytime: () => {},
      },
      /** The player presses the mute button on the CrazyGames page. */
      pressMute(on: boolean) {
        settings.muteAudio = on;
        for (const fn of listeners) fn({ ...settings });
      },
    };
  }

  /** A WebAudio stand-in: counts the roars started and knows what reaches the speakers, and at what volume. */
  function fakeAudio() {
    let started = 0;
    const destination = {};
    const toSpeakers: { gain: { value: number } }[] = [];
    const node = () => ({
      connect<T>(next: T): T {
        if (next === destination) toSpeakers.push(this as unknown as (typeof toSpeakers)[number]);
        return next;
      },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        currentTime = 0;
        sampleRate = 8000;
        destination = destination;
        async resume() {
          this.state = 'running';
        }
        createBuffer(_channels: number, length: number) {
          return { getChannelData: () => new Float32Array(Math.floor(length)) };
        }
        createBufferSource() {
          return { ...node(), buffer: null, start: () => void started++ };
        }
        createBiquadFilter() {
          return { ...node(), type: '', frequency: { value: 0 }, Q: { value: 0 } };
        }
        createGain() {
          return { ...node(), gain: { value: 1, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } };
        }
      },
    );
    return {
      started: () => started,
      /** The volume of everything that reaches the speakers (the roars play through one output). */
      volume: () => toSpeakers.map((n) => n.gain.value),
    };
  }

  async function loadPortal(sdk: ReturnType<typeof fakeSdk>, languages?: string[]): Promise<void> {
    vi.stubEnv('VITE_PORTAL', 'crazygames');
    (globalThis as Record<string, unknown>).CrazyGames = { SDK: sdk };
    await load('none', languages);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('./ui/poster');
    Reflect.deleteProperty(globalThis, 'CrazyGames');
  });

  test('the share card, the shared poster and the poster footer name no website', async () => {
    const drawn: { footer: string }[] = [];
    vi.doMock('./ui/poster', () => ({ ensurePosterFonts: async () => {}, drawSharePoster: (_: unknown, data: { footer: string }) => drawn.push(data) }));
    vi.stubGlobal('File', class { constructor(readonly parts: unknown[], readonly name: string) {} });
    const shared: string[] = [];
    const copied: string[] = [];
    await loadPortal(fakeSdk('en-US'));
    Object.assign(navigator, {
      share: async (data: { text: string }) => void shared.push(data.text),
      canShare: () => true,
      clipboard: { writeText: async (text: string) => void copied.push(text) },
    });
    await tap(en.title.free);
    draft(12);
    await skipSim();
    await tap(en.result.share);
    await tap(en.result.copy);

    expect(shared).toHaveLength(1);
    expect(copied).toEqual(shared);
    expect(drawn).toHaveLength(1);
    const poster = page.app.querySelector('.poster-foot')!.textContent;
    for (const text of [shared[0], drawn[0].footer, poster]) expect(text).not.toMatch(/invictobaseball|\.com/);
    expect(poster).toBe('Oct 11, 2026'); // the footer is the date alone (free play has no daily number)
  });

  test.each([
    ['ja-JP', 'en-US', 'ja', ja, 'Español'],
    ['es-419', 'en-US', 'es', es, 'English'],
    ['en-GB', 'es-DO', 'en', en, 'Español'],
    ['pt-BR', 'es-DO', 'en', en, 'Español'], // not one of ours: English, not the browser's Spanish
  ])('a CrazyGames player with locale %s on a %s browser starts in %s, unpinned', async (locale, browser, lang, table, nextLabel) => {
    await loadPortal(fakeSdk(locale), [browser]);
    expect(page.app.textContent).toContain(table.title.free);
    expect(document.documentElement.lang).toBe(lang);
    expect(document.title).toBe(table.meta.title);
    expect(find('button', '🌐').textContent).toBe(`🌐 ${nextLabel}`); // the switcher's first tap is the other major language
    expect(store.has('invicto.lang')).toBe(false); // a default, not the player's choice
  });

  test('a language picked in the game beats the CrazyGames locale', async () => {
    store.set('invicto.lang', 'ko');
    await loadPortal(fakeSdk('ja-JP'), ['en-US']);
    expect(page.app.textContent).toContain(ko.title.free);
    expect(document.documentElement.lang).toBe('ko');
  });

  test("the CrazyGames mute button silences the game over its own sound toggle, and cuts a roar in flight", async () => {
    const audio = fakeAudio();
    store.set('invicto.sound', 'on');
    const sdk = fakeSdk('en-US', true);
    await loadPortal(sdk);
    const toggle = find('button', '🔊');
    toggle.click(); // off
    toggle.click(); // on: the confirming roar stays silent while CrazyGames mutes
    expect(audio.started()).toBe(0);

    sdk.pressMute(false);
    toggle.click();
    toggle.click();
    expect(audio.started()).toBe(1);
    expect(audio.volume()).toEqual([1]);

    sdk.pressMute(true); // mid-roar: it goes silent at once
    expect(audio.volume()).toEqual([0]);
    toggle.click();
    toggle.click();
    expect(audio.started()).toBe(1);

    sdk.pressMute(false);
    expect(audio.volume()).toEqual([1]);
  });
});

describe('title buttons', () => {
  test('Daily and Free play say how they differ; the Daily line goes once today is played', async () => {
    await load();
    expect(find('button', DAILY).querySelector('span.sub')!.textContent).toBe(en.title.dailySub);
    expect(find('button', en.title.free).querySelector('span.sub')!.textContent).toBe(en.title.freeSub);

    await tap(DAILY);
    draft(12);
    await skipSim();
    await goHome();
    expect(page.app.querySelector('.daily-done')).not.toBeNull();
    expect(page.app.textContent).not.toContain(en.title.dailySub);
    expect(find('button', en.title.free).querySelector('span.sub')!.textContent).toBe(en.title.freeSub);
  });
});

describe('the daily card on the title', () => {
  /** A scored daily already in storage, as finish.ts writes it. */
  function played(day: string, record = '5-2', streak = 3): void {
    const [wins, losses] = record.split('-').map(Number);
    store.set(`invicto.daily.${day}`, JSON.stringify({ record, wins, losses, outcome: 'subcampeon' }));
    store.set('invicto.lastDaily', day);
    store.set('invicto.streak', String(streak));
  }
  const countdown = () => page.app.querySelector('.countdown')!.textContent;
  const at = (time: string) => en.title.nextDailyLive.replace('{time}', time);

  test('once today is played, a card with the record, the streak and a live countdown replaces the daily button', async () => {
    vi.setSystemTime(new Date(2026, 9, 11, 21, 30, 0));
    played('2026-10-11');
    await load();
    const card = page.app.querySelector('.daily-done')!;
    expect(card.querySelector('.eyebrow')!.textContent).toBe(en.title.doneEyebrow.replace('{n}', String(dailyNumber('2026-10-11'))));
    expect(card.querySelector('.day-record')!.textContent).toContain('5-2');
    const streak = card.querySelector('.streak-chip')!;
    expect(streak.textContent).toBe('🔥 3');
    expect(streak.getAttribute('aria-label')).toBe(en.title.streak.replace('{n}', '3'));
    expect(countdown()).toBe(at('02:30:00'));
    expect(page.app.textContent).not.toContain(DAILY);
    expect(page.app.querySelector('.streak-risk')).toBeNull();
    expect(find('button', en.title.free).classList.contains('primary')).toBe(true);
    expect(find('button', en.title.practice).classList.contains('chip-btn')).toBe(true);

    await vi.advanceTimersByTimeAsync(2000); // ticking, from the clock
    expect(countdown()).toBe(at('02:29:58'));
  });

  test('a run to resume still outranks the card and Free play', async () => {
    played('2026-10-11');
    await load();
    await tap(en.title.free);
    draft(3);
    await load();
    expect(page.app.querySelectorAll('button.primary').map((b) => b.textContent)).toEqual([expect.stringContaining(en.title.resume)]);
    expect(page.app.querySelector('.daily-done')).not.toBeNull();
  });

  test('at midnight the title deals the new challenge by itself', async () => {
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59, 58));
    played('2026-10-11');
    await load();
    expect(countdown()).toBe(at('00:00:02'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(page.app.querySelector('.daily-done')).toBeNull();
    expect(find('button', DAILY).textContent).toContain(`#${dailyNumber('2026-10-12')}`);
    expect(page.app.querySelector('.streak-risk')!.textContent).toBe(en.title.streakRisk.replace('{n}', '3'));
  });

  test('one countdown runs at a time, however often the title redraws, and none once it is gone', async () => {
    const active = new Set<unknown>();
    const { setInterval: setReal, clearInterval: clearReal } = globalThis;
    vi.stubGlobal('setInterval', (fn: () => void, ms: number) => {
      const id = setReal(fn, ms);
      active.add(id);
      return id;
    });
    vi.stubGlobal('clearInterval', (id: Parameters<typeof clearInterval>[0]) => {
      active.delete(id);
      clearReal(id);
    });
    played('2026-10-11');
    await load();
    expect(active.size).toBe(1);
    for (let i = 0; i < 3; i++) {
      await tap('🌐'); // the language switch draws the title again
      expect(active.size).toBe(1);
    }

    await tap(ko.title.free); // three taps from English: Korean
    await vi.advanceTimersByTimeAsync(1000);
    expect(active.size).toBe(0);
    draft(12);
    await skipSim();
    expect(active.size).toBe(0); // free play has no daily panel
    find('a', ko.result.home).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(active.size).toBe(1);
  });

  test('a streak alive from yesterday asks to play today; a broken one says nothing', async () => {
    store.set('invicto.lastDaily', '2026-10-10');
    store.set('invicto.streak', '4');
    await load();
    expect(page.app.querySelector('.streak-risk')!.textContent).toBe(en.title.streakRisk.replace('{n}', '4'));
    expect(find('button', DAILY).classList.contains('primary')).toBe(true);

    store.set('invicto.lastDaily', '2026-10-09');
    await load();
    expect(page.app.querySelector('.streak-risk')).toBeNull();
  });

  test("a returning player's numbers are chips, and a fresh profile has none", async () => {
    await load();
    expect(page.app.querySelector('.meta-chips')).toBeNull();

    store.set('invicto.best.free', JSON.stringify({ record: '6-1', wins: 6, losses: 1, outcome: 'campeon' }));
    store.set('invicto.best.hard', JSON.stringify({ record: '5-2', wins: 5, losses: 2, outcome: 'subcampeon' }));
    store.set('invicto.badges', JSON.stringify({ invicto: '2026-10-01T12:00:00.000Z', campeon: '2026-10-01T12:00:00.000Z' }));
    await load();
    const chips = page.app.querySelector('.meta-chips')!.querySelectorAll('.meta-chip').map((c) => c.textContent);
    expect(chips).toEqual([
      en.title.best.replace('{record}', '6-1'),
      en.title.bestHard.replace('{record}', '5-2'),
      en.title.badges.replace('{n}', '2').replace('{total}', '8'),
    ]);
  });

  test('the header carries no second wordmark, and the sound chip says what it is and whether it is on', async () => {
    await load();
    expect(page.app.querySelector('.brand')).toBeNull();
    const sound = find('button', '🔇');
    expect(sound.getAttribute('aria-label')).toBe(en.a11y.sound);
    expect(sound.getAttribute('aria-pressed')).toBe('false');
    sound.click();
    expect(sound.getAttribute('aria-pressed')).toBe('true');
    // The 📊 chip ships with the Stats dialog; until then the title shows no dead control.
    expect(page.app.querySelectorAll('button').filter((b) => b.textContent.includes('📊'))).toEqual([]);
  });
});

describe('honest numbers', () => {
  const depthLine = () =>
    en.title.depth
      .replace('{players}', new Intl.NumberFormat('en').format(new Set(PLAYERS.map((p) => p.personKey)).size))
      .replace('{countries}', '23')
      .replace('{editions}', '6');
  const counts = (total: number, invictos: number) => en.global.counts.replace('{total}', String(total)).replace('{invictos}', String(invictos));
  const meta = () => page.app.querySelector('.menu-meta')!.textContent;

  test('the title shows the day\'s crowd only from 25 runs; below that, what the game holds', async () => {
    await load(); // offline
    expect(meta()).toBe(depthLine());

    api['/api/today'] = { total: 24, invictos: 0, distribution: { 3: 24 } };
    await load();
    expect(meta()).toBe(depthLine());

    api['/api/today'] = { total: 25, invictos: 1, distribution: { 3: 24, 7: 1 } };
    await load();
    expect(meta()).toBe(counts(25, 1));
  });

  /** Play today's daily with the server answering `stats` (built from the committed run's wins). */
  async function scoredDaily(stats: (wins: number) => unknown): Promise<string[]> {
    const copied: string[] = [];
    await load();
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    await tap(DAILY);
    draft(12);
    api['/api/result'] = stats(JSON.parse(store.get('invicto.daily.2026-10-11')!).wins);
    await skipSim();
    await vi.advanceTimersByTimeAsync(0);
    await tap(en.result.copy);
    return copied;
  }
  const lines = () => page.app.querySelector('.global-lines')!.children.map((c) => c.textContent);

  test('the first run of the day is told so, with no percent', async () => {
    const [card] = await scoredDaily((wins) => ({ total: 1, invictos: 0, distribution: { [wins]: 1 }, yourPicks: [] }));
    expect(lines()).toEqual([en.global.first]);
    expect(card).not.toContain('%');
    expect(page.app.querySelector('.poster-foot')!.textContent).not.toContain('%');
  });

  test('under 25 runs the result counts the crowd and shows no percent', async () => {
    const [card] = await scoredDaily((wins) => ({ total: 24, invictos: 0, distribution: { [wins]: 24 }, yourPicks: [{ id: 'x', n: 1 }] }));
    expect(lines()).toEqual([counts(24, 0)]);
    expect(card).not.toContain('%');
  });

  test('from 25 runs the result ranks the run against the others, and a top half run shares its Top line', async () => {
    let wins = -1;
    const [card] = await scoredDaily((w) => {
      wins = w;
      return { total: 30, invictos: 0, distribution: { [w - 1]: 29, [w]: 1 }, yourPicks: [] };
    });
    expect(wins).toBeGreaterThan(0); // the 2026-10-11 test daily wins games, so 29 runs can sit below it
    expect(lines()).toEqual([en.global.beat.replace('{pct}', '100'), counts(30, 0)]);
    expect(card).toContain(en.global.top.replace('{pct}', '3'));
  });
});

describe('the daily panel on the result', () => {
  test('a scored daily shows the streak it grew, the countdown and a Free play button', async () => {
    store.set('invicto.lastDaily', '2026-10-10');
    store.set('invicto.streak', '4');
    await load();
    await tap(DAILY);
    draft(12);
    await skipSim();
    const panel = page.app.querySelector('.daily-panel')!;
    expect(panel.querySelector('.eyebrow')!.textContent).toBe(en.title.doneEyebrow.replace('{n}', String(dailyNumber('2026-10-11'))));
    const streak = panel.querySelector('.streak-chip')!;
    expect(streak.textContent).toBe('🔥 5');
    expect(streak.classList.contains('pop')).toBe(true);
    expect(panel.querySelector('.countdown')!.textContent).toMatch(/^Next challenge in \d\d:\d\d:\d\d$/);
    expect(find('button', en.result.practiceAgain)).toBeDefined();

    await tap(en.title.free);
    expect(page.app.querySelector('.draft-screen')).not.toBeNull();
    expect(page.body.querySelector('.toast')?.textContent).not.toBe(en.draft.practiceNote);
  });

  test('a practice replay shows the scored attempt instead of a streak, and its card and poster say practice', async () => {
    const copied: string[] = [];
    await load();
    await tap(DAILY);
    draft(12);
    await skipSim();
    const scored = JSON.parse(store.get('invicto.daily.2026-10-11')!).record;
    await tap(en.result.practiceAgain);
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    draft(12);
    await skipSim();

    const panel = page.app.querySelector('.daily-panel')!;
    expect(panel.querySelector('.streak-chip')).toBeNull();
    expect(panel.textContent).toContain(en.result.practice);
    expect(panel.textContent).toContain(en.result.scoredAttempt.replace('{record}', scored));
    await tap(en.result.copy);
    expect(copied[0].split('\n')[0]).toBe(`INVICTO #${dailyNumber('2026-10-11')} ${en.share.practice} ⚾`);
    expect(page.app.querySelector('.poster-foot')!.textContent.endsWith(`#${dailyNumber('2026-10-11')} ${en.share.practice}`)).toBe(true);
  });

  test('a daily dealt before midnight and finished after keeps its number and date, and the next button deals the new day', async () => {
    const copied: string[] = [];
    vi.setSystemTime(new Date(2026, 9, 10, 23, 59));
    await load();
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    await tap(DAILY);
    draft(12);
    vi.setSystemTime(new Date(2026, 9, 11, 0, 5));
    await skipSim();

    expect(page.app.querySelector('.poster-foot')!.textContent).toBe('invictobaseball.com/en  ·  Oct 10, 2026  ·  #122');
    await tap(en.result.copy);
    expect(copied[0].split('\n')[0]).toBe('INVICTO #122 ⚾');
    expect(page.app.textContent).not.toContain(en.result.practiceAgain);
    await tap(`⭐ ${en.title.dailyNum.replace('{n}', '123')}`);
    expect(page.app.querySelector('.draft-screen')).not.toBeNull();
    expect(page.body.querySelector('.toast')?.textContent).not.toBe(en.draft.practiceNote); // a scored run
  });

  test('at midnight the result keeps its screen and offers the new challenge', async () => {
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59, 50));
    await load();
    await tap(DAILY);
    draft(12);
    await skipSim();
    expect(find('button', en.result.practiceAgain)).toBeDefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.app.querySelector('.result-screen')).not.toBeNull();
    expect(page.app.querySelector('.daily-panel .countdown')).toBeNull();
    expect(page.app.textContent).not.toContain(en.result.practiceAgain);
    expect(find('button', `⭐ ${en.title.dailyNum.replace('{n}', String(dailyNumber('2026-10-12')))}`)).toBeDefined();
  });
});

describe('dialogs', () => {
  /** Focus a control and activate it, as Tab then Enter does. */
  async function press(el: FakeElement): Promise<void> {
    el.focus();
    el.click();
    await vi.advanceTimersByTimeAsync(0);
  }

  const openDialog = () => page.body.querySelectorAll('dialog').filter((d) => d.open);

  describe('How to play', () => {
    async function openHowto() {
      await load();
      const opener = find('button', en.title.howto);
      await press(opener);
      const [dialog] = openDialog();
      const strip = dialog.querySelector('.howto-panels')!;
      // No layout in the fake: lay the panels out as a 327 px strip with a 16 px gap would.
      dialog.querySelectorAll('.howto-panel').forEach((panel, i) => (panel.offsetLeft = i * 343));
      return {
        opener,
        dialog,
        strip,
        back: dialog.querySelector('button.howto-back')!,
        next: dialog.querySelector('button.howto-next')!,
        dots: dialog.querySelectorAll('button.howto-dot'),
      };
    }
    const step = (dots: FakeElement[]) => dots.findIndex((d) => d.getAttribute('aria-current') === 'step');

    test('opens on panel 1 of 4, named by its heading, with focus on Next and no Back', async () => {
      const { dialog, back, next, dots } = await openHowto();
      expect(dialog.classList.contains('howto')).toBe(true);
      const heading = dialog.querySelector('h2')!;
      expect(heading.textContent).toBe(en.title.howto);
      expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
      expect(dialog.querySelectorAll('.howto-panel').map((p) => p.querySelector('h3')!.textContent)).toEqual(en.howto.panels.map((p) => p.title));
      expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual([1, 2, 3, 4].map((n) => `Step ${n} of 4`));
      expect(step(dots)).toBe(0);
      expect(activeElement()).toBe(next);
      expect(next.textContent).toContain(en.howto.next);
      expect(back.classList.contains('off')).toBe(true);
    });

    test.each([
      ['the Next button', (c: Awaited<ReturnType<typeof openHowto>>) => c.next.click()],
      ['the second dot', (c: Awaited<ReturnType<typeof openHowto>>) => c.dots[1].click()],
      ['ArrowRight', () => pressKey('ArrowRight')],
    ])('%s reaches panel 2 and scrolls the strip to that panel', async (_, act) => {
      const c = await openHowto();
      act(c);
      expect(step(c.dots)).toBe(1);
      expect(c.strip.scrollLeft).toBe(343); // the panel's offsetLeft, gap included
      expect(c.back.classList.contains('off')).toBe(false);
    });

    test('Back and ArrowLeft step back, and neither end overshoots', async () => {
      const c = await openHowto();
      pressKey('ArrowLeft');
      expect(step(c.dots)).toBe(0);
      c.dots[3].click();
      pressKey('ArrowRight');
      expect(step(c.dots)).toBe(3);
      c.back.click();
      expect(step(c.dots)).toBe(2);
      pressKey('ArrowLeft');
      expect(step(c.dots)).toBe(1);
    });

    test('Next becomes Close on the last panel and closes it; focus returns to How to play', async () => {
      const c = await openHowto();
      for (let i = 0; i < 3; i++) c.next.click();
      expect(step(c.dots)).toBe(3);
      expect(c.next.textContent).toBe(en.dialog.close);
      c.next.click();
      expect(openDialog()).toHaveLength(0);
      expect(activeElement()).toBe(c.opener);
    });

    test('a swipe updates the dots once the strip settles', async () => {
      const c = await openHowto();
      c.strip.scrollLeft = 686;
      c.strip.dispatch('scroll');
      await vi.advanceTimersByTimeAsync(200);
      expect(step(c.dots)).toBe(2);
    });

    test('Escape closes it and focus returns to How to play', async () => {
      const c = await openHowto();
      pressKey('Escape');
      expect(openDialog()).toHaveLength(0);
      expect(activeElement()).toBe(c.opener);
    });
  });

  test('About: named by its heading; Escape closes it and focus returns to the link', async () => {
    await load();
    const link = find('a', en.footer.about);
    await press(link);
    const [dialog] = openDialog();
    expect(dialog.querySelector('h2')!.textContent).toBe(en.footer.about);
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')!.id);
    expect(dialog.textContent).toContain(en.footer.aboutText);
    pressKey('Escape');
    expect(openDialog()).toHaveLength(0);
    expect(activeElement()).toBe(link);
  });

  test('slot picker: Enter on a multi-position row opens it on the first slot; Escape returns to the row', async () => {
    await load();
    await tap(DAILY);
    page.app.querySelector('.roll-card')!.click();
    // Round 1: every slot is open, so the first legal row fits at least two (its position and DH, or SP and RP).
    const row = page.app.querySelectorAll('button.player-row').find((b) => !b.classList.contains('taken') && !b.classList.contains('ineligible'))!;
    await press(row);
    const [dialog] = openDialog();
    expect(dialog.classList.contains('sheet')).toBe(true);
    const heading = dialog.querySelector('h2')!;
    expect(heading.textContent).toBe(en.draft.pickSlot.replace('{name}', row.querySelector('b')!.textContent));
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    const slots = dialog.querySelectorAll('button.slot-option');
    expect(slots.length).toBeGreaterThanOrEqual(2);
    expect(activeElement()).toBe(slots[0]); // no Tabs needed to reach a slot

    pressKey('Escape');
    expect(openDialog()).toHaveLength(0);
    expect(activeElement()).toBe(row);
    expect(page.app.querySelector('.roll-round')!.textContent).toBe(en.draft.round.replace('{n}', '1')); // nothing picked

    await press(row);
    openDialog()[0].querySelector('button.slot-option')!.click();
    expect(openDialog()).toHaveLength(0);
    expect(page.app.querySelector('.roll-round')!.textContent).toBe(en.draft.round.replace('{n}', '2'));
  });

  test('load error: opens with focus on Retry; Escape returns to the button tapped; Retry loads again', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline (test stub)');
    });
    await load();
    const free = find('button', en.title.free);
    await press(free);
    const [dialog] = openDialog();
    expect(dialog.classList.contains('load-error')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('p')!.id);
    expect(dialog.querySelector('p')!.textContent).toBe(en.boot.error);
    expect(activeElement().textContent).toBe(en.boot.retry);

    pressKey('Escape');
    expect(openDialog()).toHaveLength(0);
    expect(activeElement()).toBe(free);

    await press(free); // the load still failed: the same dialog, not two
    expect(openDialog()).toHaveLength(1);
    vi.stubGlobal('fetch', async (url: string) => ({ ok: true, json: async () => DATA[Object.keys(DATA).find((name) => url.endsWith(`/data/${name}`))!] }));
    find('button', en.boot.retry).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(openDialog()).toHaveLength(0);
    await tap(en.title.free);
    expect(page.app.querySelector('.draft-screen')).not.toBeNull();
  });
});
