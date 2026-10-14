// End-to-end flows: the real main.ts boots on the fake DOM (src/test/fakedom.ts)
// with the real roster data, every /api call failing (nothing reaches the
// Worker), and fake timers driving the roll spin and the sim reveal. A "reload"
// drops the page's timers and modules but keeps localStorage, like a phone
// reloading a background tab. These guard the wiring between screens, which
// the unit tests cannot see.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { canEditionReroll, POWERS, rollBase, rollCountryReroll } from './engine/draft';
import { SLOTS } from './engine/positions';
import type { EditionTeams, EnginePlayer, Roll } from './engine/types';
import { draftGrade } from './game/scout';
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
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage', 'location', 'history']) Reflect.deleteProperty(globalThis, name);
});

/** Load the page: a fresh DOM and fresh modules over the same localStorage. hash: the address's fragment. */
async function load(fault: StorageFault = 'none', languages?: string[], hash?: string): Promise<void> {
  const now = Date.now();
  vi.clearAllTimers(); // the previous page's timers die with it (this also resets the fake clock)
  vi.setSystemTime(now);
  vi.resetModules();
  page = installDom(languages, hash);
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

/** Settle each spin and draft the first (or last) legal player into the first offered slot. */
function draft(picks: number, pick: 'first' | 'last' = 'first'): void {
  for (let i = 0; i < picks; i++) {
    const card = page.app.querySelector('.roll-card');
    if (card?.classList.contains('spinning')) card.click();
    const legal = page.app.querySelectorAll('button.player-row').filter((b) => !b.classList.contains('taken') && !b.classList.contains('ineligible'));
    const row = pick === 'first' ? legal[0] : legal.at(-1);
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
    const graded = dailyResult('2026-10-11');
    expect(graded).toMatchObject(committed); // the same run, now with its draft grade
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
    expect(dailyResult('2026-10-11')).toEqual(graded);
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

  test.each([
    ['the challenge', en.challenge.button],
    ['the poster image', en.challenge.shareImage],
  ])('a second tap on %s while the share sheet is open does nothing', async (_, label) => {
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
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('File', class { constructor(readonly parts: unknown[], readonly name: string) {} });
    vi.stubGlobal('ClipboardItem', class { constructor(readonly items: unknown) {} });
    await load();
    Object.assign(navigator, { share, canShare: () => true, clipboard: { write, writeText } });
    await tap(DAILY);
    draft(12);
    await skipSim();

    const button = find('button', label);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(share).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);

    closeSheet();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.disabled).toBe(false);
    expect(toasts()).toEqual([]);
  });

  test('the challenge shares text alone, the image shares the poster with the same text as its caption', async () => {
    vi.doMock('./ui/poster', () => ({ ensurePosterFonts: async () => {}, drawSharePoster: () => {} }));
    vi.stubGlobal('File', class { constructor(readonly parts: unknown[], readonly name: string) {} });
    const shared: { text: string; files?: unknown[] }[] = [];
    await load();
    Object.assign(navigator, { share: async (data: { text: string; files?: unknown[] }) => void shared.push(data), canShare: () => true });
    await tap(en.title.free);
    draft(12);
    await skipSim();
    expect(page.app.querySelector('.result-btns')!.children.map((b) => b.textContent)).toEqual([
      en.challenge.button, en.challenge.shareImage, en.result.again,
    ]);
    expect(find('button', en.challenge.button).classList.contains('primary')).toBe(true);
    await tap(en.challenge.button);
    await tap(en.challenge.shareImage);
    expect(shared[0].files).toBeUndefined(); // iOS drops the text, and the link, when files ride along
    expect(shared[1].files).toHaveLength(1);
    expect(shared[1].text).toBe(shared[0].text);
  });

  test.each([
    ['es', es, 'invictobaseball.com/'],
    ['en', en, 'invictobaseball.com/en/'],
    ['ja', ja, 'invictobaseball.com/ja/'],
    ['ko', ko, 'invictobaseball.com/ko/'],
  ])('in %s the challenge ends with the dare and a link in that language, and the poster footer starts with the site', async (lang, table, site) => {
    const copied: string[] = [];
    await load('none', [lang]);
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    await tap(table.title.free);
    draft(12);
    await skipSim();
    await tap(table.challenge.button);
    expect(copied).toHaveLength(1);
    const lines = copied[0].split('\n');
    expect(lines.at(-2)).toBe(table.challenge.shareLine);
    expect(lines.at(-1)).toMatch(new RegExp(`^https://${site.replace(/[./]/g, '\\$&')}#r=free-[0-9a-z]+-[0-9a-z]+\\.[0-9a-z]{4}[0-9A-Za-z]{24}$`));
    expect(toasts()).toEqual([table.challenge.copied]);
    expect(page.app.querySelector('.poster-foot')!.textContent.startsWith(`${site.replace(/\/$/, '')}  ·  `)).toBe(true);
  });

  test('where neither share nor the clipboard works, the text waits in a dialog, selected', async () => {
    await load();
    Object.assign(navigator, { share: async () => Promise.reject(new DOMException('Not allowed in this frame', 'NotAllowedError')) });
    await tap(en.title.free);
    draft(12);
    await skipSim();
    await tap(en.challenge.button);
    const dialog = page.body.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    const area = dialog.querySelector('textarea')!;
    expect(area.value).toContain('#r=free-');
    expect(activeElement()).toBe(area);
    expect(toasts()).toEqual([]);
  });

  test('the nickname field signs the link and is remembered', async () => {
    const copied: string[] = [];
    await load();
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    await tap(en.title.free);
    draft(12);
    await skipSim();
    const input = page.app.querySelector('input.nick-input')!;
    expect(input.value).toBe('');
    input.value = ' Ana\u202E ';
    input.dispatch('input');
    expect(store.get('invicto.nick')).toBe('Ana');
    await tap(en.challenge.button);
    expect(copied[0].split('\n').at(-1)).toMatch(/~Ana$/);
    await tap(en.result.again);
    draft(12);
    await skipSim();
    expect(page.app.querySelector('input.nick-input')!.value).toBe('Ana');
  });
});

describe('challenge links', () => {
  afterEach(() => {
    vi.doUnmock('./game/state');
    vi.doUnmock('./game/stats');
  });

  /** Play a run on a fresh device, share the challenge and return its link. pick: which legal player each round. */
  async function challengeFrom(mode: string, pick: 'first' | 'last' = 'first', nick = ''): Promise<{ link: string; record: string; firstRoll: string }> {
    store = new Map();
    const copied: string[] = [];
    await load();
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    if (nick) store.set('invicto.nick', nick);
    await tap(mode);
    const firstRoll = rollShown();
    draft(12, pick);
    await skipSim();
    const record = page.app.querySelector('.poster-record')!.textContent;
    await tap(en.challenge.button);
    return { link: copied[0].split('\n').at(-1)!, record, firstRoll };
  }

  /** The current roll as the card shows it once landed. */
  function rollShown(): string {
    const card = page.app.querySelector('.roll-card')!;
    if (card.classList.contains('spinning')) card.click();
    return `${card.querySelector('.roll-country')!.textContent} ${card.querySelector('.roll-edition')!.textContent}`;
  }

  const fragment = (link: string) => link.slice(link.indexOf('#'));
  const card = () => page.app.querySelector('.challenge-card');
  const golds = () => page.app.querySelectorAll('button.primary').map((b) => b.textContent);

  test("a free run's link deals a friend the same rolls and ends on the head-to-head", async () => {
    const ana = await challengeFrom(en.title.free, 'first', 'Ana');
    expect(ana.link).toMatch(/^https:\/\/invictobaseball\.com\/en\/#r=free-.+~Ana$/);

    store = new Map(); // Luis, on his phone
    await load('none', undefined, fragment(ana.link));
    expect(location.hash).toBe(''); // read once, then gone from the address bar
    expect(card()!.querySelector('h2')!.textContent).toBe(`Ana went ${ana.record} on this deal`);
    expect(card()!.textContent).toContain(en.challenge.sub);
    expect(card()!.querySelector('.challenge-chip')!.textContent).toBe(`⚾\uFE0F ${en.title.free}`);
    expect(golds()).toEqual([en.challenge.accept]); // the challenge is the one gold button
    expect(page.app.querySelector('.draft-screen')).toBeNull(); // never starts a run by itself

    await tap(en.challenge.accept);
    expect(toasts()).toEqual([en.challenge.sub]);
    expect(rollShown()).toBe(ana.firstRoll);
    expect(page.app.querySelector('.roll-round')!.textContent).toBe(`${en.draft.round.replace('{n}', '1')} · ⚔️ Ana ${ana.record}`);
    draft(12); // the same picks Ana made: a dead heat

    const sim = page.app.querySelector('.sim-screen')!;
    await vi.advanceTimersByTimeAsync(400);
    sim.click();
    // Each card carries Ana's game at the same stage: the same lineup, the same games.
    const rivalLines = page.app.querySelectorAll('.game-flavor').filter((l) => l.classList.contains('rival')).map((l) => l.textContent);
    expect(rivalLines).toHaveLength(page.app.querySelectorAll('.game-card.reveal').length);
    for (const card of page.app.querySelectorAll('.game-card.reveal')) {
      const ours = card.querySelector('.game-score')!.textContent.match(/(\d+) · \D+ (\d+)$/)!;
      const theirs = card.querySelectorAll('.game-flavor').find((l) => l.classList.contains('rival'))!.textContent;
      expect(theirs).toBe(`⚔️ Ana: ${ours[1]}-${ours[2]} ${card.classList.contains('win') ? '✅' : '❌'}`);
    }
    await vi.advanceTimersByTimeAsync(1000);

    const vs = page.app.querySelector('.vs-card')!;
    expect(vs.querySelector('h2')!.textContent).toBe(en.challenge.tie.replace('{name}', 'Ana'));
    expect(vs.querySelectorAll('.vs-record').map((r) => r.textContent)).toEqual([ana.record, ana.record]);
    expect(vs.querySelector('tbody')!.children).toHaveLength(7);
    expect(vs.querySelector('.vs-matched')!.textContent).toBe(en.challenge.matched.replace('{n}', '12'));
    expect(vs.querySelector('details.vs-lineups')!.querySelectorAll('.vs-lineup-row')).toHaveLength(13);
    expect(golds()).toEqual([en.challenge.rematch]); // Send it back is the gold one; the challenge is still there
    expect(find('button', en.challenge.button).classList.contains('primary')).toBe(false);
    expect(page.app.querySelector('.poster-vs')!.textContent).toBe(`vs Ana ${ana.record} · same rolls`);
    // His own run is kept, so Ana's next link for this deal opens on the comparison.
    expect(JSON.parse(store.get('invicto.mine')!)).toHaveLength(1);
  });

  test("today's daily, unplayed: the link starts the real scored daily with the rival", async () => {
    const ana = await challengeFrom(DAILY, 'last');
    store = new Map();
    await load('none', undefined, fragment(ana.link));
    expect(card()!.querySelector('h2')!.textContent).toBe(`${en.challenge.anonymous.replace('{record}', ana.record)}`);
    expect(card()!.querySelector('.challenge-chip')!.textContent).toBe(`⭐ ${en.challenge.dailyChip.replace('{n}', String(dailyNumber('2026-10-11')))}`);
    expect(find('button', DAILY).classList.contains('primary')).toBe(false); // demoted while the card shows
    await tap(en.challenge.accept);
    expect(rollShown()).toBe(ana.firstRoll);
    draft(12);
    await skipSim();
    expect(dailyResult('2026-10-11')).not.toBeNull();
    expect(posts()).toBeGreaterThan(0);
    expect(page.app.querySelector('.vs-card')).not.toBeNull();
    expect(page.app.querySelector('.daily-panel')).not.toBeNull();
  });

  test('a deal already played opens straight on the comparison: nothing saved, sent or earned', async () => {
    const ana = await challengeFrom(DAILY, 'last', 'Ana');
    store = new Map(); // Luis played today's daily before her link came in
    await load();
    await tap(DAILY);
    draft(12);
    await skipSim();
    const luis = page.app.querySelector('.poster-record')!.textContent;
    await goHome();

    const saveDaily = vi.fn();
    const submit = vi.fn();
    vi.doMock('./game/state', async (importOriginal) => {
      const real = await importOriginal<typeof import('./game/state')>();
      return { ...real, saveDailyResult: (...args: Parameters<typeof real.saveDailyResult>) => (saveDaily(...args), real.saveDailyResult(...args)) };
    });
    vi.doMock('./game/stats', async (importOriginal) => {
      const real = await importOriginal<typeof import('./game/stats')>();
      return { ...real, submitResult: (...args: Parameters<typeof real.submitResult>) => (submit(...args), real.submitResult(...args)) };
    });
    const before = new Map(store);
    const postsBefore = posts();
    await load('none', undefined, fragment(ana.link));
    expect(card()!.querySelector('.challenge-chip')!.textContent).toBe(en.challenge.playedChip);
    await tap(en.challenge.accept);

    expect(page.app.querySelector('.draft-screen')).toBeNull();
    const vs = page.app.querySelector('.vs-card')!;
    expect(vs.querySelectorAll('.vs-record').map((r) => r.textContent)).toEqual([luis, ana.record]);
    expect(page.app.querySelector('.poster-record')!.textContent).toBe(luis);
    expect(page.app.querySelector('.badge-chip')).toBeNull();
    expect(page.app.querySelector('.daily-panel')).toBeNull();
    expect(page.app.textContent).not.toContain(en.result.practice);
    expect(saveDaily).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(posts()).toBe(postsBefore);
    expect(store).toEqual(before); // no daily, streak, best, badge or run written
  });

  test('a past daily plays as practice on its own seed', async () => {
    const ana = await challengeFrom(DAILY);
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
    store = new Map();
    await load('none', undefined, fragment(ana.link));
    expect(card()!.querySelector('.challenge-chip')!.textContent).toBe(en.challenge.pastChip.replace('{n}', String(dailyNumber('2026-10-11'))));
    await tap(en.challenge.accept);
    expect(rollShown()).toBe(ana.firstRoll);
    draft(1);
    expect(JSON.parse(store.get('invicto.run')!)).toMatchObject({ mode: 'free', scored: false, seed: 'daily-2026-10-11', rival: ana.link.split('#r=')[1] });
    draft(11);
    await skipSim();
    expect(store.has('invicto.best.free')).toBe(false);
    expect(dailyResult('2026-10-13')).toBeNull();
    expect(page.app.querySelector('.vs-card')).not.toBeNull();
  });

  test("a past daily played here as practice compares under that daily's number and date, and the next button names today's", async () => {
    const ana = await challengeFrom(DAILY, 'first', 'Ana');
    const ben = await challengeFrom(DAILY, 'last', 'Ben');
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
    store = new Map(); // Luis answers Ana's link two days later, as practice
    await load('none', undefined, fragment(ana.link));
    await tap(en.challenge.accept);
    draft(12);
    await skipSim();
    await goHome();

    const copied: string[] = [];
    await load('none', undefined, fragment(ben.link)); // then Ben's link to the same daily comes in
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    expect(card()!.querySelector('.challenge-chip')!.textContent).toBe(en.challenge.playedChip);
    await tap(en.challenge.accept);
    expect(page.app.querySelector('.vs-card')).not.toBeNull();
    const dealt = dailyNumber('2026-10-11');
    expect(page.app.querySelector('.poster-foot')!.textContent.startsWith(`invictobaseball.com/en  ·  Oct 11, 2026  ·  #${dealt}`)).toBe(true);
    await tap(en.challenge.button);
    expect(copied[0].split('\n')[0].startsWith(`INVICTO #${dealt} `)).toBe(true);
    // Today's daily is unplayed: the button names it, and it deals it scored, not as practice.
    expect(page.app.textContent).not.toContain(en.result.practiceAgain);
    await tap(`⭐ ${en.title.dailyNum.replace('{n}', String(dailyNumber('2026-10-13')))}`);
    expect(page.app.querySelector('.draft-screen')).not.toBeNull();
    expect(page.body.querySelector('.toast')?.textContent).not.toBe(en.draft.practiceNote);
  });

  test("a past daily compared after today's daily is done: the next button says practice, and it deals practice", async () => {
    const ana = await challengeFrom(DAILY, 'first', 'Ana');
    const ben = await challengeFrom(DAILY, 'last', 'Ben');
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
    store = new Map(); // Luis answers Ana's link two days later, as practice, then plays today's daily
    await load('none', undefined, fragment(ana.link));
    await tap(en.challenge.accept);
    draft(12);
    await skipSim();
    await goHome();
    await tap(DAILY);
    draft(12);
    await skipSim();
    await goHome();
    expect(dailyResult('2026-10-13')).not.toBeNull();

    await load('none', undefined, fragment(ben.link));
    await tap(en.challenge.accept);
    expect(page.app.querySelector('.vs-card')).not.toBeNull();
    await tap(en.result.practiceAgain);
    expect(page.app.querySelector('.draft-screen')).not.toBeNull();
    expect(toasts()).toContain(en.draft.practiceNote);
  });

  test('a deal played here whose lineup the rosters no longer hold is dealt afresh, and the card says so before Accept', async () => {
    const ana = await challengeFrom(DAILY, 'last', 'Ana');
    store = new Map(); // Luis played today's daily; a roster rebuild then retired one of his picks
    await load();
    await tap(DAILY);
    draft(12);
    await skipSim();
    await goHome();
    const [kept] = JSON.parse(store.get('invicto.mine')!);
    store.set('invicto.mine', JSON.stringify([{ ...kept, ids: ['retired-player', ...kept.ids.slice(1)] }]));

    await load('none', undefined, fragment(ana.link));
    expect(card()!.querySelector('.challenge-chip')!.textContent).toBe(en.draft.practiceNote); // today's daily, already played
    await tap(en.challenge.accept);
    expect(page.app.querySelector('.draft-screen')).not.toBeNull();
    expect(rollShown()).toBe(ana.firstRoll);
  });

  test('a reload during a challenge draft resumes it with the rival', async () => {
    const ana = await challengeFrom(en.title.hard, 'first', 'Ana');
    store = new Map();
    await load('none', undefined, fragment(ana.link));
    await tap(en.challenge.accept);
    draft(3);
    await load(); // the phone reloads the tab: no fragment any more
    expect(card()).toBeNull();
    await tap(en.title.resume);
    expect(page.app.querySelector('.roll-round')!.textContent).toContain(`⚔️ Ana ${ana.record}`);
  });

  test('Not now puts the card away and gives the gold back to the menu', async () => {
    const ana = await challengeFrom(en.title.free);
    store = new Map();
    await load('none', undefined, fragment(ana.link));
    await tap(en.challenge.dismiss);
    expect(card()).toBeNull();
    expect(golds()).toEqual([find('button', DAILY).textContent]);
  });

  test('your own link asks you to share it', async () => {
    const ana = await challengeFrom(en.title.free, 'first', 'Ana');
    const copied: string[] = [];
    await load('none', undefined, fragment(ana.link)); // the same device
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    expect(card()!.querySelector('h2')!.textContent).toBe(en.challenge.own);
    await tap(en.challenge.button);
    expect(copied).toEqual([`${en.challenge.shareLine}\n${ana.link}`]);
  });

  test.each([
    ['not a code', '#r=hello'],
    ['a daily still to come', `#r=daily-2026-10-12.ab0g${'0'.repeat(24)}`], // 0-4 is a pattern a run can have
    ['an unknown player', 'unknown'],
  ])('a link that is %s is ignored silently, and still leaves the address bar', async (_, hash) => {
    if (hash === 'unknown') {
      const ana = await challengeFrom(en.title.free);
      const code = fragment(ana.link);
      const at = code.indexOf('.') + 5;
      hash = `${code.slice(0, at)}zz${code.slice(at + 2)}`; // the catcher's index points past the rosters
      store = new Map();
    }
    await load('none', undefined, hash);
    expect(location.hash).toBe('');
    expect(card()).toBeNull();
    expect(find('button', DAILY).classList.contains('primary')).toBe(true);
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

  test('without invite links the image share, the poster and its footer name no website, and no challenge is offered', async () => {
    const drawn: { footer: string; stats: string; versus?: string }[] = [];
    vi.doMock('./ui/poster', () => ({ ensurePosterFonts: async () => {}, drawSharePoster: (_: unknown, data: { footer: string; stats: string }) => drawn.push(data) }));
    vi.stubGlobal('File', class { constructor(readonly parts: unknown[], readonly name: string) {} });
    const shared: string[] = [];
    await loadPortal(fakeSdk('en-US'));
    Object.assign(navigator, { share: async (data: { text: string }) => void shared.push(data.text), canShare: () => true });
    await tap(en.title.free);
    draft(12);
    await skipSim();
    expect(page.app.querySelector('.result-btns')!.children.map((b) => b.textContent)).toEqual([en.challenge.shareImage, en.result.again]);
    expect(find('button', en.challenge.shareImage).classList.contains('primary')).toBe(true);
    expect(page.app.querySelector('input.nick-input')).toBeNull();
    await tap(en.challenge.shareImage);

    expect(shared).toHaveLength(1);
    expect(drawn).toHaveLength(1);
    const poster = page.app.querySelector('.poster-foot')!.textContent;
    for (const text of [shared[0], drawn[0].footer, poster]) expect(text).not.toMatch(/invictobaseball|\.com|https?:/);
    expect(shared[0]).not.toContain(en.challenge.shareLine); // no dare without a link to answer it
    // The date (free play has no daily number), then the Team OVR and the draft grade.
    expect(poster).toMatch(/^Oct 11, 2026  ·  OVR \d{2}\.\d  ·  [SABCD]$/);
    expect(`${drawn[0].footer}  ·  ${drawn[0].stats}`).toBe(poster);
  });

  test("a challenge goes out as CrazyGames' invite link, and the link it opens deals that challenge", async () => {
    const copied: string[] = [];
    const sdk = fakeSdk('en-US');
    const invites: Record<string, string>[] = [];
    Object.assign(sdk.game, {
      inviteLink: (params: Record<string, string>) => (invites.push(params), `https://www.crazygames.com/game/invicto?r=${encodeURIComponent(params.r)}`),
      getInviteParam: () => null,
    });
    await loadPortal(sdk);
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    await tap(en.title.free);
    draft(12);
    await skipSim();
    await tap(en.challenge.button);
    const lines = copied[0].split('\n');
    expect(lines.slice(-2)).toEqual([en.challenge.shareLine, `https://www.crazygames.com/game/invicto?r=${encodeURIComponent(invites[0].r)}`]);
    expect(copied[0]).not.toMatch(/invictobaseball/);

    // A friend opens it: CrazyGames hands the game its r param.
    store = new Map();
    Object.assign(sdk.game, { getInviteParam: async (name: string) => (name === 'r' ? invites[0].r : null) });
    await loadPortal(sdk);
    expect(page.app.querySelector('.challenge-card')).not.toBeNull();
    await tap(en.challenge.accept);
    expect(page.app.querySelector('.roll-round')!.textContent).toContain('⚔️');
  });

  test('the scouting report keeps its formula but links nowhere outside the game', async () => {
    await loadPortal(fakeSdk('en-US'));
    await tap(en.title.free);
    draft(12);
    await skipSim();
    const engine = page.app.querySelector('details.scout-engine')!;
    expect(engine.querySelector('.scout-formula')).not.toBeNull();
    expect(page.app.querySelector('.scout-card')!.querySelectorAll('a')).toHaveLength(0);
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
    await tap(en.challenge.button);
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

  // As one line, the site, date, number, OVR, grade and Top line ran past the
  // image's 900 px text width in every locale, and the canvas squeezed the glyphs.
  test('a top half run shares an image with where and when on one footer line and the OVR, the grade and the Top line on the next', async () => {
    const drawn: { footer: string; stats: string }[] = [];
    vi.doMock('./ui/poster', () => ({ ensurePosterFonts: async () => {}, drawSharePoster: (_: unknown, data: { footer: string; stats: string }) => drawn.push(data) }));
    vi.stubGlobal('File', class { constructor(readonly parts: unknown[], readonly name: string) {} });
    try {
      await scoredDaily((w) => ({ total: 30, invictos: 0, distribution: { [w - 1]: 29, [w]: 1 }, yourPicks: [] }));
      Object.assign(navigator, { share: async () => {}, canShare: () => true });
      await tap(en.challenge.shareImage);
    } finally {
      vi.doUnmock('./ui/poster');
    }
    expect(drawn).toHaveLength(1);
    expect(drawn[0].footer).toBe(`invictobaseball.com/en  ·  Oct 11, 2026  ·  #${dailyNumber('2026-10-11')}`);
    expect(drawn[0].stats).toMatch(new RegExp(`^OVR \\d{2}\\.\\d  ·  [SABCD]  ·  ${en.global.top.replace('{pct}', '3')}$`));
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
    await tap(en.challenge.button);
    expect(copied[0].split('\n')[0]).toBe(`INVICTO #${dailyNumber('2026-10-11')} ${en.share.practice} ⚾`);
    expect(page.app.querySelector('.poster-foot')!.textContent).toContain(`  ·  #${dailyNumber('2026-10-11')} ${en.share.practice}  ·  OVR `);
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

    expect(page.app.querySelector('.poster-foot')!.textContent).toMatch(/^invictobaseball\.com\/en  ·  Oct 10, 2026  ·  #122  ·  OVR /);
    await tap(en.challenge.button);
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

describe('the scouting report on the result', () => {
  const ENGINE = 'https://github.com/aaguasvivas/invicto/blob/main/src/engine/';

  /** Every element under #app in document order. */
  const inOrder = (): FakeElement[] => {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => el.children.forEach((child) => (out.push(child), walk(child)));
    walk(page.app);
    return out;
  };
  const position = (cls: string) => inOrder().findIndex((el) => el.classList.contains(cls));

  test('sits under the buttons, above the crowd lines and the tip, and explains the run', async () => {
    await load();
    await tap(en.title.free);
    draft(12);
    await skipSim();
    expect(page.app.dataset.screen).toBe('result');
    const card = page.app.querySelector('.scout-card')!;
    expect(card).not.toBeNull();
    expect(position('result-btns')).toBeLessThan(position('scout-card'));
    expect(position('scout-card')).toBeLessThan(position('global-lines'));
    expect(position('global-lines')).toBeLessThan(position('tip-link'));

    expect(card.querySelector('.scout-title')!.textContent).toBe(en.scout.title);
    expect(card.querySelector('.scout-ovr-label')!.textContent).toBe(en.scout.teamOvr);
    expect(card.querySelector('.scout-ovr')!.textContent).toMatch(/^\d{1,2}\.\d$/);

    // Six bars in engine order, one of them the gate, which holds the lowest value.
    const rows = card.querySelectorAll('.scout-row');
    expect(rows.map((row) => row.querySelector('.scout-label')!.textContent)).toEqual(Object.values(en.scout.cat));
    const values = rows.map((row) => Number(row.querySelector('.scout-value')!.textContent));
    const gates = card.querySelectorAll('.scout-row.gate');
    expect(gates).toHaveLength(1);
    expect(Number(gates[0].querySelector('.scout-value')!.textContent)).toBe(Math.min(...values));
    expect(gates[0].querySelector('.scout-tag')!.textContent).toBe(en.scout.gateTag);
    expect(card.querySelectorAll('.scout-tag')).toHaveLength(1);

    // One line per loss, each with its verdict.
    const losses = page.app.querySelectorAll('.poster-games')[0].textContent.split('❌').length - 1;
    const verdicts = [en.scout.lossLuck, en.scout.lossCoin, en.scout.lossUnderdog].map(
      (template) => new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+')}$`),
    );
    const lines = card.querySelectorAll('.scout-loss').map((el) => el.querySelector('.scout-loss-text')!.textContent);
    expect(lines).toHaveLength(losses);
    for (const line of lines) expect(verdicts.some((v) => v.test(line)), line).toBe(true);

    expect(card.querySelector('.scout-picks')!.textContent).toContain(en.scout.bestPick);
    expect(card.querySelector('.scout-picks')!.textContent).toContain(en.scout.weakLink);
    expect(card.querySelector('.scout-odds')!.textContent).toMatch(/^With this lineup: title [<\d.]+% · INVICTO [<\d.]+%$/);

    const engine = card.querySelector('details.scout-engine')!;
    expect(engine.querySelector('summary')!.textContent).toBe(en.scout.howEngine);
    expect(engine.querySelectorAll('a').map((a) => a.href)).toEqual([`${ENGINE}teamRating.ts`, `${ENGINE}simulate.ts`]);
    const formulas = engine.querySelectorAll('.scout-formula').map((el) => el.textContent).join('\n');
    expect(formulas).toContain(`= ${card.querySelector('.scout-ovr')!.textContent}`);

    await goHome();
    expect(page.app.dataset.screen).toBe('title');
  });

  test.each([
    ['es', es],
    ['ja', ja],
    ['ko', ko],
  ])('in %s it names the team number the same way everywhere', async (lang, table) => {
    await load('none', [lang]);
    await tap(table.title.free);
    draft(12);
    await skipSim();
    const card = page.app.querySelector('.scout-card')!;
    expect(card.querySelector('.scout-ovr-label')!.textContent).toBe(table.scout.teamOvr);
    expect(card.querySelectorAll('.scout-label').map((el) => el.textContent)).toEqual(Object.values(table.scout.cat));
  });

  test('Hard Mode shows no rating during the draft and reveals all twelve after the run', async () => {
    await load();
    await tap(en.title.hard);
    expect(page.app.dataset.screen).toBe('draft');
    expect(page.app.querySelectorAll('.rating-chip')).toHaveLength(0);
    draft(6);
    expect(page.app.querySelectorAll('.rating-chip')).toHaveLength(0);
    draft(6);
    expect(page.app.dataset.screen).toBe('sim');
    expect(page.app.querySelectorAll('.rating-chip')).toHaveLength(0);
    await skipSim();
    const reveal = page.app.querySelector('.scout-reveal')!;
    expect(reveal.querySelector('.scout-reveal-title')!.textContent).toBe(en.scout.hardReveal);
    const chips = reveal.querySelectorAll('.rating-chip').map((el) => Number(el.textContent));
    expect(chips).toHaveLength(12);
    for (const rating of chips) expect(rating).toBeGreaterThan(0);
  });

  test('a free run has no reveal: the ratings were on screen all along', async () => {
    await load();
    await tap(en.title.free);
    draft(12);
    await skipSim();
    expect(page.app.querySelector('.scout-reveal')).toBeNull();
  });
});

describe('the scout’s lineup and the draft grade', () => {
  /** Skip the reveal and stop the moment the result screen renders, before its first frame. */
  async function landOnResult(): Promise<void> {
    const sim = page.app.querySelector('.sim-screen')!;
    await vi.advanceTimersByTimeAsync(400);
    sim.click();
    await vi.advanceTimersByTimeAsync(900);
    expect(page.app.dataset.screen).toBe('result');
  }
  const section = () => page.app.querySelector('.scout-lineup')!;
  const fill = (template: string, params: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => params[key]);
  /** The scout the engine builds on a seed, from the rosters the page loaded. */
  async function engineScout(seed: string) {
    const [{ loadData }, { scoutLineup }] = await Promise.all([import('./game/data'), import('./game/scout')]);
    return scoutLineup(seed, await loadData())!;
  }

  test('holds its place with a loading line, then grades the draft against the scout and keeps the grade with the day', async () => {
    const copied: string[] = [];
    await load();
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    await tap(DAILY);
    draft(12);
    await landOnResult();
    const card = page.app.querySelector('.scout-card')!;
    expect(section().querySelector('.scout-lineup-title')!.textContent).toBe(en.scout.lineupTitle);
    expect(section().querySelector('.scout-loading')!.textContent).toBe(en.scout.loading);
    expect(section().querySelector('.grade-badge')!.textContent).toBe('');
    expect(dailyResult('2026-10-11').grade).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1000);
    const scout = await engineScout('daily-2026-10-11');
    const saved = dailyResult('2026-10-11');
    expect(saved.ovr).toBe(Number(card.querySelector('.scout-ovr')!.textContent));
    expect(saved.par).toEqual({ ovr: Math.round(scout.ovr * 10) / 10, wins: scout.run.wins, losses: scout.run.losses });
    expect(saved.grade).toBe(draftGrade(saved.par.ovr - saved.ovr));
    expect(section().querySelector('.scout-loading')).toBeNull();
    expect(section().querySelector('.grade-badge')!.textContent).toBe(saved.grade);
    expect(section().querySelector('.scout-grade-label')!.textContent).toBe(saved.grade === 'S' ? en.scout.gradeS : fill(en.scout.grade, { g: saved.grade }));
    const par = `${saved.par.wins}-${saved.par.losses}`;
    expect(section().querySelector('.scout-grade-line')!.textContent).toBe(fill(en.scout.lineupLine, { n: saved.par.ovr.toFixed(1), record: par }));

    // Twelve slots, yours against the scout's, the picks you share dimmed.
    const more = card.querySelector('details.scout-more')!;
    expect(more.querySelector('summary')!.textContent).toBe(en.scout.toggle);
    expect(more.querySelector('thead')!.textContent).toBe(`${en.challenge.you}${saved.ovr.toFixed(1)}${en.scout.scoutCol}${saved.par.ovr.toFixed(1)}`);
    const rows = more.querySelector('tbody')!.querySelectorAll('tr');
    expect(rows.map((row) => row.querySelector('th')!.textContent)).toEqual([...SLOTS]);
    const pick = (td: FakeElement) => `${td.querySelector('.scout-vs-name')!.textContent} ${td.querySelector('.ed')!.textContent}`;
    rows.forEach((row, i) => {
      const [yours, theirs] = row.querySelectorAll('td').map(pick);
      const want = scout.lineup[SLOTS[i]]!;
      expect(theirs).toBe(`${want.name} '${String(want.edition).slice(2)}`);
      expect(row.classList.contains('same')).toBe(yours === theirs);
    });

    // The poster and the share card carry it.
    expect(page.app.querySelector('.poster-foot')!.textContent.endsWith(`  ·  OVR ${saved.ovr.toFixed(1)}  ·  ${saved.grade}`)).toBe(true);
    await tap(en.challenge.button);
    expect(copied[0].split('\n')).toContain(`📋 Draft ${saved.grade} · OVR ${saved.ovr.toFixed(1)}`);
  });

  test('stops for good when the player leaves the result before it lands: no grade, no error', async () => {
    await load();
    await tap(DAILY);
    draft(12);
    await landOnResult();
    await goHome();
    await vi.advanceTimersByTimeAsync(5000);
    expect(page.app.dataset.screen).toBe('title');
    expect(dailyResult('2026-10-11').grade).toBeUndefined();
  });

  test('a practice replay is graded on screen but never replaces the scored run’s grade', async () => {
    await load();
    await tap(DAILY);
    draft(12);
    await skipSim();
    const scored = dailyResult('2026-10-11');
    expect(scored.grade).toMatch(/^[SABCD]$/);
    await tap(en.result.practiceAgain);
    draft(12, 'last');
    await skipSim();
    expect(section().querySelector('.grade-badge')!.textContent).toMatch(/^[SABCD]$/);
    expect(dailyResult('2026-10-11')).toEqual(scored);
  });

  test('a round played on a roll the scout never saw is marked, and the mark is explained once', async () => {
    await load();
    await tap(en.title.free);
    page.app.querySelector('.roll-card')!.click(); // land the first roll
    await tap(en.draft.rerollCountry);
    draft(12);
    await skipSim();
    const marks = page.app.querySelectorAll('.scout-reroll');
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute('aria-label')).toBe(en.scout.rerolledHere);
    expect(page.app.querySelector('.scout-reroll-note')!.textContent).toBe(en.scout.rerolledHere);
  });

  test('a run that never touched a reroll explains no mark', async () => {
    await load();
    await tap(en.title.free);
    draft(12);
    await skipSim();
    const marks = page.app.querySelectorAll('.scout-reroll').length;
    expect(page.app.querySelectorAll('.scout-reroll-note')).toHaveLength(marks > 0 ? 1 : 0); // a free roll can still change a round
  });

  test('Hard Mode grades the draft after the ratings it kept hidden', async () => {
    await load();
    await tap(en.title.hard);
    draft(12);
    await skipSim();
    const card = page.app.querySelector('.scout-card')!;
    const order = card.querySelectorAll('div').map((el) => el.className);
    expect(order.indexOf('scout-reveal scout-section')).toBeLessThan(order.indexOf('scout-lineup scout-section'));
    expect(section().querySelector('.grade-badge')!.textContent).toMatch(/^[SABCD]$/);
  });

  describe('yesterday on the title', () => {
    const strip = () => page.app.querySelector('.yesterday-strip');

    test('shows one line once yesterday’s scored daily carries its grade', async () => {
      store.set(
        'invicto.daily.2026-10-10',
        JSON.stringify({ record: '4-2', wins: 4, losses: 2, outcome: 'eliminated-sf', ovr: 80.4, grade: 'B', par: { ovr: 82.9, wins: 5, losses: 2 } }),
      );
      await load();
      expect(strip()!.textContent).toBe(fill(en.scout.yesterday, { n: String(dailyNumber('2026-10-10')), record: '4-2', par: '5-2', g: 'B' }));
      const children = page.app.querySelector('.title-screen')!.children;
      expect(children.indexOf(strip()!)).toBe(children.indexOf(page.app.querySelector('.menu')!) + 1);
    });

    test('an entry saved before grades existed renders the title with no strip and no error', async () => {
      store.set('invicto.daily.2026-10-10', JSON.stringify({ record: '4-2', wins: 4, losses: 2, outcome: 'eliminated-sf' }));
      await load();
      expect(page.app.querySelector('.menu')).not.toBeNull();
      expect(strip()).toBeNull();
    });

    test('only yesterday’s: an older graded daily shows nothing', async () => {
      store.set(
        'invicto.daily.2026-10-09',
        JSON.stringify({ record: '4-2', wins: 4, losses: 2, outcome: 'eliminated-sf', ovr: 80.4, grade: 'B', par: { ovr: 82.9, wins: 5, losses: 2 } }),
      );
      await load();
      expect(strip()).toBeNull();
    });
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
