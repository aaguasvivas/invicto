// Draft screen: roll reveal with slot-machine spin, searchable roster grouped by
// position, reroll buttons, pinned lineup tray. Ratings hidden in hard mode.

import { eligibleSlots, SLOTS } from '../../engine/positions';
import { openSlots, POWERS } from '../../engine/draft';
import type { EnginePlayer, Slot } from '../../engine/types';
import { countryName, t } from '../../i18n';
import { setAccent } from '../accents';
import { crowdRoar, vibrate } from '../sound';
import type { Session } from '../../game/session';
import {
  canRerollCountry, canRerollEdition, currentRoster, draftDone, pick, rerollCountry, rerollEdition,
} from '../../game/session';
import { openDialog } from '../dialog';
import { clear, h, toast } from '../dom';
import { ratingChip } from '../ratingChip';
import { nameSearch } from '../search';

const PITCHER_POS: Slot[] = ['SP', 'RP', 'CL'];
const SPIN_MS = 700;

/** Club names are proper nouns; only the English notes the data adds to them are translated. */
function clubLabel(club: string): string {
  if (club === 'Free agent') return t('draft.freeAgent');
  const note = / \((minors|farm)\)$/.exec(club);
  return note ? t(`draft.${note[1]}`, { club: club.slice(0, note.index) }) : club;
}

export interface DraftCallbacks {
  onDone: () => void;
  /** Fires after every pick or reroll, so an interrupted run can be resumed. */
  onChange?: () => void;
}

export function renderDraft(app: HTMLElement, session: Session, cb: DraftCallbacks): void {
  clear(app);
  app.dataset.screen = 'draft';
  const screen = h('div.draft-screen');
  app.append(screen);
  // Same-rolls practice replay of the daily: say so before anyone thinks it's a bug.
  if (session.mode === 'daily' && !session.scored) toast(t('draft.practiceNote'));
  drawRound(screen, session, cb, true);
}

function drawRound(screen: HTMLElement, session: Session, cb: DraftCallbacks, spin: boolean): void {
  clear(screen);
  const country = session.data.countries.get(session.roll.country)!;
  setAccent(spin ? null : session.roll.country);

  if (session.autoRedrew) toast(t('draft.noEligible'));

  // --- roll card ---
  const flagEl = h('span.roll-flag', {}, country.flag);
  const nameEl = h('div.roll-country.display', {}, countryName(country));
  const editionEl = h('div.roll-edition', {}, t('draft.edition', { year: session.roll.edition }));
  // A reroll redraws the round, so its click stops here: bubbling on to this
  // (by then replaced) card would land the old spin showing the new roll.
  const reroll = (apply: (s: Session) => void) => (e: Event) => {
    e.stopPropagation();
    apply(session);
    cb.onChange?.();
    drawRound(screen, session, cb, true);
  };
  const editionLabel = session.state.editionRerollUsed
    ? `${t('draft.rerollEdition')} ×0`
    : canRerollEdition(session)
      ? `${t('draft.rerollEdition')} ×1`
      : t('draft.oneEdition', { year: session.roll.edition }); // the country played a single Classic
  const rollCard = h(
    'div.roll-card',
    {},
    h('div.roll-round', {}, t('draft.round', { n: session.state.round + 1 })),
    flagEl,
    nameEl,
    editionEl,
    h(
      'div.reroll-row',
      {},
      h(
        'button.reroll-btn',
        { disabled: !canRerollCountry(session), onclick: reroll(rerollCountry) },
        `${t('draft.rerollCountry')} ${canRerollCountry(session) ? '×1' : '×0'}`,
      ),
      h('button.reroll-btn', { disabled: !canRerollEdition(session), onclick: reroll(rerollEdition) }, editionLabel),
    ),
  );

  // --- roster ---
  const findPlayers = nameSearch(currentRoster(session));
  const search = h('input.search-box', {
    type: 'search',
    placeholder: t('draft.search'),
    oninput: () => renderRoster(),
  }) as HTMLInputElement;

  const rosterEl = h('div.roster');

  const renderRoster = () => {
    clear(rosterEl);
    const open = openSlots(session.state);
    const players = findPlayers(search.value);
    const fit = new Set(
      players
        .filter((p) => !session.state.draftedPersons.includes(p.personKey) && eligibleSlots(p.positions, open).length > 0)
        .map((p) => p.id),
    );
    const order = session.mode === 'hard'
      ? (a: EnginePlayer, b: EnginePlayer) => a.name.localeCompare(b.name)
      : (a: EnginePlayer, b: EnginePlayer) => b.rating - a.rating;

    const groups: { key: string; test: (p: EnginePlayer) => boolean }[] = [
      { key: 'C', test: (p) => p.positions.includes('C') },
      { key: 'IF', test: (p) => p.positions.some((pos) => ['1B', '2B', '3B', 'SS'].includes(pos)) },
      { key: 'OF', test: (p) => p.positions.some((pos) => ['LF', 'CF', 'RF'].includes(pos)) },
      { key: 'DH', test: (p) => p.positions.some((pos) => !PITCHER_POS.includes(pos)) }, // two-way stars land here
      { key: 'P', test: () => true }, // pure pitchers
    ];
    const seen = new Set<string>();
    const sections = groups
      .map((group) => {
        const members = players.filter((p) => !seen.has(p.id) && group.test(p));
        members.forEach((p) => seen.add(p.id));
        // Who fits an open slot first: late in the draft they would otherwise
        // sit under a screenful of greyed-out rows.
        members.sort((a, b) => Number(fit.has(b.id)) - Number(fit.has(a.id)) || order(a, b));
        return { key: group.key, members };
      })
      .filter((section) => section.members.length > 0);
    // Groups with someone to pick lead; the rest keep their usual order (stable sort).
    sections.sort((a, b) => Number(fit.has(b.members[0].id)) - Number(fit.has(a.members[0].id)));
    for (const { key, members } of sections) {
      rosterEl.append(h('div.pos-group-label', {}, t(`draft.posGroups.${key}`)));
      for (const p of members) rosterEl.append(playerRow(p, open));
    }
    const q = search.value.trim();
    if (sections.length === 0 && q) rosterEl.append(h('div.roster-empty', {}, t('draft.noResults', { q })));
  };

  const playerRow = (p: EnginePlayer, open: Slot[]): HTMLElement => {
    const taken = session.state.draftedPersons.includes(p.personKey);
    const slots = eligibleSlots(p.positions, open);
    return h(
      'button.player-row' + (taken ? '.taken' : slots.length === 0 ? '.ineligible' : ''),
      {
        onclick: () => {
          if (taken || slots.length === 0) return;
          if (slots.length === 1) confirmPick(p, slots[0]);
          else showSlotSheet(p, slots);
        },
      },
      h('span.player-pos', {}, p.positions.slice(0, 2).join('·')),
      h(
        'span.player-name',
        {},
        h('b', {}, taken ? `✓ ${p.name}` : p.name),
        p.club ? h('span', {}, clubLabel(p.club)) : null,
      ),
      session.mode !== 'hard' ? ratingChip(p.rating) : null,
    );
  };

  const confirmPick = (p: EnginePlayer, slot: Slot) => {
    pick(session, p, slot);
    // Autosave every pick, the 12th included: a reload during the sim then
    // resumes the full lineup instead of reopening the last pick.
    cb.onChange?.();
    if (draftDone(session)) cb.onDone();
    else drawRound(screen, session, cb, true);
  };

  // Opens with focus on the first slot, so a keyboard pick is Enter, Enter.
  const showSlotSheet = (p: EnginePlayer, slots: Slot[]) => {
    const heading = h('h2.dialog-title', {}, t('draft.pickSlot', { name: p.name }));
    const options = slots.map((slot) =>
      h('button.slot-option', { type: 'button', onclick: () => { dialog.close(); confirmPick(p, slot); } }, slot),
    );
    const dialog = openDialog({ variant: 'sheet', heading, content: [heading, h('div.slot-options', {}, ...options)] });
  };

  // --- lineup tray ---
  const tray = h('div.lineup-tray');
  const drawTray = () => {
    clear(tray);
    const grid = h(
      'div.lineup-grid',
      {},
      ...SLOTS.map((slot) => {
        const who = session.state.lineup[slot];
        const flag = who ? session.data.countries.get(who.country)!.flag : '·';
        return h('div.lineup-cell' + (who ? '.filled' : ''), {}, h('span.slot', {}, slot), h('span.who', {}, flag));
      }),
    );
    const list = h(
      'div.lineup-list',
      {},
      ...SLOTS.filter((s) => session.state.lineup[s]).map((slot) => {
        const who = session.state.lineup[slot]!;
        return h(
          'div.lineup-line',
          {},
          h('span.slot', {}, slot),
          h('span', {}, session.data.countries.get(who.country)!.flag),
          h('b', {}, who.name),
          h('span', {}, `'${String(who.edition).slice(2)}`),
        );
      }),
    );
    tray.append(
      h(
        'button.lineup-toggle',
        { onclick: () => tray.classList.toggle('open') },
        h('span', {}, `${t('draft.lineup')} (${SLOTS.length - openSlots(session.state).length}/${SLOTS.length})`),
        h('span', {}, '▴'),
      ),
      grid,
      list,
    );
  };
  drawTray();

  screen.append(rollCard, search, rosterEl, tray);

  // --- slot machine spin ---
  if (spin) {
    const all = [...session.data.countries.values()];
    const years = Object.keys(session.data.editionTeams);
    rollCard.classList.add('spinning');
    let stopped = false;
    const interval = setInterval(() => {
      const random = all[Math.floor(Math.random() * all.length)];
      flagEl.textContent = random.flag;
      nameEl.textContent = countryName(random);
      editionEl.textContent = t('draft.edition', { year: years[Math.floor(Math.random() * years.length)] });
    }, 70);
    const settle = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      if (!rollCard.isConnected) return; // a reroll replaced this card mid-spin; the new card lands itself
      rollCard.classList.remove('spinning');
      flagEl.textContent = country.flag;
      nameEl.textContent = countryName(country);
      editionEl.textContent = t('draft.edition', { year: session.roll.edition });
      setAccent(session.roll.country);
      if (POWERS.includes(session.roll.country)) {
        rollCard.classList.add('power-roll');
        crowdRoar(0.5);
        vibrate(15);
      }
      renderRoster();
    };
    rollCard.addEventListener('click', settle, { once: true });
    setTimeout(settle, SPIN_MS);
  } else {
    if (POWERS.includes(session.roll.country)) rollCard.classList.add('power-roll');
    renderRoster();
  }
}
