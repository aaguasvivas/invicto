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
import { clear, h, toast } from '../dom';

const PITCHER_POS: Slot[] = ['SP', 'RP', 'CL'];
const SPIN_MS = 700;

export interface DraftCallbacks {
  onDone: () => void;
  /** Fires after every pick or reroll, so an interrupted run can be resumed. */
  onChange?: () => void;
}

export function renderDraft(app: HTMLElement, session: Session, cb: DraftCallbacks): void {
  clear(app);
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
  const editionEl = h('div.roll-edition', {}, `WBC ${session.roll.edition}`);
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
        {
          disabled: !canRerollCountry(session),
          onclick: () => { rerollCountry(session); cb.onChange?.(); drawRound(screen, session, cb, true); },
        },
        `${t('draft.rerollCountry')} ${canRerollCountry(session) ? '×1' : '×0'}`,
      ),
      h(
        'button.reroll-btn',
        {
          disabled: !canRerollEdition(session),
          onclick: () => { rerollEdition(session); cb.onChange?.(); drawRound(screen, session, cb, true); },
        },
        `${t('draft.rerollEdition')} ${!session.state.editionRerollUsed ? '×1' : '×0'}`,
      ),
    ),
  );

  // --- roster ---
  const search = h('input.search-box', {
    type: 'search',
    placeholder: t('draft.search'),
    oninput: () => renderRoster(),
  }) as HTMLInputElement;

  const rosterEl = h('div.roster');

  const renderRoster = () => {
    clear(rosterEl);
    const q = search.value.trim().toLowerCase();
    const open = openSlots(session.state);
    const players = currentRoster(session).filter((p) => !q || p.name.toLowerCase().includes(q));

    const groups: { key: string; test: (p: EnginePlayer) => boolean }[] = [
      { key: 'C', test: (p) => p.positions.includes('C') },
      { key: 'IF', test: (p) => p.positions.some((pos) => ['1B', '2B', '3B', 'SS'].includes(pos)) },
      { key: 'OF', test: (p) => p.positions.some((pos) => ['LF', 'CF', 'RF'].includes(pos)) },
      { key: 'DH', test: (p) => p.positions.some((pos) => !PITCHER_POS.includes(pos)) }, // two-way stars land here
      { key: 'P', test: () => true }, // pure pitchers
    ];
    const seen = new Set<string>();
    let shown = 0;
    for (const group of groups) {
      const members = players.filter((p) => !seen.has(p.id) && group.test(p));
      members.forEach((p) => seen.add(p.id));
      if (members.length === 0) continue;
      shown += members.length;
      members.sort(session.mode === 'hard' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.rating - a.rating);
      rosterEl.append(h('div.pos-group-label', {}, t(`draft.posGroups.${group.key}`)));
      for (const p of members) rosterEl.append(playerRow(p, open));
    }
    if (shown === 0 && q) rosterEl.append(h('div.roster-empty', {}, t('draft.noResults', { q: search.value.trim() })));
  };

  const playerRow = (p: EnginePlayer, open: Slot[]): HTMLElement => {
    const taken = session.state.draftedPersons.includes(p.personKey);
    const slots = eligibleSlots(p.positions, open);
    const chipClass = p.rating >= 95 ? 'r95' : p.rating >= 85 ? 'r85' : p.rating >= 70 ? 'r70' : '';
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
        p.club ? h('span', {}, p.club) : null,
      ),
      session.mode !== 'hard' ? h('span.rating-chip' + (chipClass ? `.${chipClass}` : ''), {}, String(p.rating)) : null,
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

  const showSlotSheet = (p: EnginePlayer, slots: Slot[]) => {
    const overlay = h(
      'div.sheet-overlay',
      { onclick: (e: Event) => { if (e.target === overlay) overlay.remove(); } },
      h(
        'div.sheet',
        {},
        h('h3', {}, t('draft.pickSlot', { name: p.name })),
        h('div.slot-options', {}, ...slots.map((slot) => h('button.slot-option', { onclick: () => { overlay.remove(); confirmPick(p, slot); } }, slot))),
      ),
    );
    document.body.append(overlay);
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
      editionEl.textContent = `WBC ${years[Math.floor(Math.random() * years.length)]}`;
    }, 70);
    const settle = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      rollCard.classList.remove('spinning');
      flagEl.textContent = country.flag;
      nameEl.textContent = countryName(country);
      editionEl.textContent = `WBC ${session.roll.edition}`;
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
