// Result poster screen: the screenshot moment. Saves scored results, fires
// confetti, and offers share / copy / play-again.

import type { RunResult, Slot } from '../../engine/types';
import { getLocale, t } from '../../i18n';
import type { Session } from '../../game/session';
import { dailyNumber, saveBest, saveDailyResult } from '../../game/state';
import { setAccent } from '../accents';
import { clear, h, toast } from '../dom';
import { confetti } from '../confetti';
import type { PosterData } from '../poster';
import { emojiCard, copyText, sharePoster, type ShareContext } from '../share';

const SLOT_ORDER: Slot[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'CL'];

export interface ResultCallbacks {
  onAgain: () => void;
  onHome: () => void;
}

export function renderResult(app: HTMLElement, session: Session, run: RunResult, cb: ResultCallbacks): void {
  clear(app);
  setAccent(null);
  const record = `${run.wins}-${run.losses}`;
  const tier: PosterData['tier'] =
    run.outcome === 'invicto' ? 'invicto' : run.outcome === 'campeon' ? 'campeon' : run.outcome === 'subcampeon' ? 'subcampeon' : 'out';

  if (session.scored) {
    const stored = { record, wins: run.wins, losses: run.losses, outcome: run.outcome };
    if (session.mode === 'daily') saveDailyResult(stored);
    saveBest(session.mode, stored);
  }

  const lineupRows = SLOT_ORDER.map((slot) => {
    const p = session.state.lineup[slot]!;
    return { slot, flag: session.data.countries.get(p.country)!.flag, name: p.name, edition: p.edition };
  });
  const gameFlags = run.games.map((g) => ({ flag: session.data.countries.get(g.opponent.country)!.flag, win: g.win }));
  const dailyNum = session.mode === 'daily' ? dailyNumber() : null;
  const dateStr = new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const footerLine = [t('share.url'), dateStr, dailyNum ? `#${dailyNum}` : null].filter(Boolean).join('  ·  ');

  const stageKey = run.outcome.startsWith('eliminated') ? run.outcome.replace('eliminated-', '') : null;
  const tierLine =
    run.outcome === 'invicto'
      ? t('share.tiers.invicto')
      : run.outcome === 'campeon'
        ? t('share.tiers.campeon', { record })
        : run.outcome === 'subcampeon'
          ? t('share.tiers.subcampeon', { record })
          : t('result.eliminatedShare', { stage: t(`result.stageShort.${stageKey}`), record });

  const shareCtx: ShareContext = { run, dailyNum, hard: session.mode === 'hard', tierLine, gameFlags };
  const posterData: PosterData = {
    brand: 'INVICTO',
    tagline: t('tagline'),
    record,
    tier,
    tierLabel: t(`result.${run.outcome}`),
    lineup: lineupRows,
    games: gameFlags,
    footer: footerLine,
    hard: session.mode === 'hard',
  };

  const posterEl = h(
    'div.poster.' + (tier === 'subcampeon' ? 'out' : tier),
    {},
    h('div.poster-tier.display', {}, t(`result.${run.outcome}`)),
    h('div.poster-record', {}, record),
    h('div.poster-sub', {}, t(`result.${run.outcome}Sub`)),
    h(
      'div.poster-lineup',
      {},
      ...lineupRows.map((row) =>
        h(
          'div.poster-line',
          {},
          h('span.slot', {}, row.slot),
          h('span', {}, row.flag),
          h('span', {}, row.name),
          h('span.ed', {}, `'${String(row.edition).slice(2)}`),
        ),
      ),
    ),
    h('div.poster-games', {}, ...gameFlags.map((g) => h('span', {}, `${g.flag}${g.win ? '✅' : '❌'}`))),
    h('div.poster-foot', {}, footerLine + (session.mode === 'hard' ? '  ·  🔥' : '')),
  );

  const buttons = h(
    'div.result-btns',
    {},
    h(
      'button.btn.primary',
      {
        onclick: async () => {
          const result = await sharePoster(posterData, emojiCard(shareCtx));
          if (result === 'copied-image' || result === 'copied-text') toast(t('result.copied'));
        },
      },
      t('result.share'),
    ),
    h(
      'button.btn',
      {
        onclick: async () => {
          if (await copyText(emojiCard(shareCtx))) toast(t('result.copied'));
        },
      },
      t('result.copy'),
    ),
    h('button.btn', { onclick: cb.onAgain }, t('result.again')),
  );

  app.append(
    h(
      'div.result-screen',
      {},
      h('div', { style: 'height:14px' }),
      posterEl,
      buttons,
      !session.scored && session.mode === 'daily' ? h('div.result-meta', {}, t('result.practice')) : null,
      h(
        'div.result-meta',
        {},
        h('a', { href: '#', style: 'color:var(--text-dim)', onclick: (e: Event) => { e.preventDefault(); cb.onHome(); } }, t('result.home')),
      ),
    ),
  );

  if (run.outcome === 'invicto') confetti('invicto');
  else if (run.outcome === 'campeon') confetti('campeon');
}
