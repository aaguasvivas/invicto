// Result poster screen: the screenshot moment. The run is already saved
// (game/finish.ts, before the sim reveal); this shows it, sends scored dailies
// to the global stats, fires confetti, and offers share / copy / play-again.

import { SLOTS } from '../../engine/positions';
import type { RunResult } from '../../engine/types';
import { getLocale, t } from '../../i18n';
import type { Session } from '../../game/session';
import type { BadgeId } from '../../game/badges';
import { dailyNumber } from '../../game/state';
import { percentileBeaten, rarestPick, submitResult, topSharePct } from '../../game/stats';
import { setAccent } from '../accents';
import { mountAd } from '../ads';
import { tipLink } from '../tip';
import { siteLinks } from '../siteLinks';
import { IS_PORTAL } from '../../portal';
import { clear, h, toast } from '../dom';
import { confetti } from '../confetti';
import type { PosterData } from '../poster';
import { emojiCard, copyText, sharePoster, siteUrl, type ShareContext } from '../share';

export interface ResultCallbacks {
  onAgain: () => void;
  onHome: () => void;
}

/** newBadges: the badges this run earned for the first time (they pop). */
export function renderResult(app: HTMLElement, session: Session, run: RunResult, newBadges: BadgeId[], cb: ResultCallbacks): void {
  clear(app);
  setAccent(null);
  const record = `${run.wins}-${run.losses}`;
  const tier: PosterData['tier'] =
    run.outcome === 'invicto' ? 'invicto' : run.outcome === 'campeon' ? 'campeon' : run.outcome === 'subcampeon' ? 'subcampeon' : 'out';

  // The tier line already announces INVICTO/CAMPEÓN, so the share line leads with the rarer badges.
  const badgeShareOrder = [...newBadges].sort(
    (a, b) => Number(a === 'invicto' || a === 'campeon') - Number(b === 'invicto' || b === 'campeon'),
  );
  const badgeLine = newBadges.length > 0 ? `🏅 ${badgeShareOrder.slice(0, 2).map((id) => t(`badges.${id}.name`)).join(' · ')}` : null;

  const lineupRows = SLOTS.map((slot) => {
    const p = session.state.lineup[slot]!;
    return { slot, flag: session.data.countries.get(p.country)!.flag, name: p.name, edition: p.edition };
  });
  const gameFlags = run.games.map((g) => ({ flag: session.data.countries.get(g.opponent.country)!.flag, win: g.win }));
  const dailyNum = session.mode === 'daily' ? dailyNumber() : null;
  const dateStr = new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const footerLine = [siteUrl(), dateStr, dailyNum ? `#${dailyNum}` : null].filter(Boolean).join('  ·  ');

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

  // Global daily stats: submit scored dailies, then enrich the screen + shares.
  let globalTopPct: number | null = null;
  const globalLine = () => (globalTopPct !== null ? t('global.top', { pct: globalTopPct }) : null);
  const extraLines = () => [globalLine(), badgeLine].filter(Boolean).join('\n') || null;
  const posterForShare = (): PosterData =>
    globalTopPct !== null ? { ...posterData, footer: `${footerLine}  ·  ${t('global.top', { pct: globalTopPct })}` } : posterData;
  const statsEl = h('div.result-meta');
  // Portal builds have no stats backend (see title.ts).
  if (session.mode === 'daily' && session.scored && !IS_PORTAL) {
    const picks = SLOTS.map((slot) => session.state.lineup[slot]!.id);
    void submitResult({ day: session.day, wins: run.wins, losses: run.losses, outcome: run.outcome, picks }).then((today) => {
      if (!today) return;
      globalTopPct = topSharePct(run.wins, today.distribution);
      const pct = percentileBeaten(run.wins, today.distribution);
      const parts = [pct === null ? t('global.first') : t('global.beat', { pct })];
      parts.push(t('global.counts', { total: today.total, invictos: today.invictos }));
      const rare = rarestPick(today.yourPicks ?? [], today.total);
      if (rare) {
        const who = Object.values(session.state.lineup).find((p) => p?.id === rare.id);
        if (who) parts.push(t('global.rarest', { name: who.name, pct: rare.pct }));
      }
      statsEl.append(...parts.map((line) => h('div', {}, line)));
    });
  }

  // Disabled until the share settles: a second tap while the share sheet is
  // open would fail over to the clipboard and toast 'Copied' behind the sheet.
  const shareBtn = h(
    'button.btn.primary',
    {
      onclick: async () => {
        shareBtn.disabled = true;
        try {
          const result = await sharePoster(posterForShare(), emojiCard(shareCtx, extraLines()));
          if (result === 'copied-image' || result === 'copied-text') toast(t('result.copied'));
          else if (result === 'failed') toast(t('result.shareFailed'));
        } finally {
          shareBtn.disabled = false;
        }
      },
    },
    t('result.share'),
  ) as HTMLButtonElement;
  const buttons = h(
    'div.result-btns',
    {},
    shareBtn,
    h(
      'button.btn',
      {
        onclick: async () => {
          if (await copyText(emojiCard(shareCtx, extraLines()))) toast(t('result.copied'));
          else toast(t('result.shareFailed'));
        },
      },
      t('result.copy'),
    ),
    h('button.btn', { onclick: cb.onAgain }, session.mode === 'daily' ? t('result.practiceAgain') : t('result.again')),
  );

  const adBox = h('div.ad-box');
  mountAd(adBox, 'result');

  const badgesEl =
    newBadges.length > 0
      ? h(
          'div.badge-chips',
          {},
          ...newBadges.map((id, i) =>
            h(
              'div.badge-chip',
              { style: `animation-delay:${0.25 + i * 0.15}s` },
              h('div.badge-name', {}, `🏅 ${t(`badges.${id}.name`)}`),
              h('div.badge-desc', {}, t(`badges.${id}.desc`)),
            ),
          ),
        )
      : null;

  app.append(
    h(
      'div.result-screen',
      {},
      h('div', { style: 'height:14px' }),
      posterEl,
      badgesEl,
      buttons,
      tipLink() ? h('div.result-meta', {}, tipLink()) : null,
      statsEl,
      !session.scored && session.mode === 'daily' ? h('div.result-meta', {}, t('result.practice')) : null,
      session.mode === 'daily' ? h('div.result-meta', {}, t('result.dailyNote')) : null,
      adBox,
      h(
        'div.result-meta',
        {},
        h('a', { href: '#', style: 'color:var(--text-dim)', onclick: (e: Event) => { e.preventDefault(); cb.onHome(); } }, t('result.home')),
      ),
      siteLinks(),
    ),
  );

  if (run.outcome === 'invicto') confetti('invicto');
  else if (run.outcome === 'campeon') confetti('campeon');
}
