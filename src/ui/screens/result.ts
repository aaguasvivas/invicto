// Result poster screen: the screenshot moment. The run is already saved
// (game/finish.ts, before the sim reveal); this shows it, sends scored dailies
// to the global stats, fires confetti, and offers share / copy / play-again.
// A daily run also gets the day card: its challenge, the streak and the
// countdown to the next one. The scouting report (ui/scoutCard.ts) explains
// the run. From 960 px the screen is two columns: the poster and its buttons
// on the left, the day card and the report in a sticky column on the right.

import { SLOTS } from '../../engine/positions';
import type { RunResult } from '../../engine/types';
import { getLocale, t } from '../../i18n';
import type { Session } from '../../game/session';
import type { BadgeId } from '../../game/badges';
import { currentStreak, dailyNumber, dailyResult, todayKey } from '../../game/state';
import { percentileBeaten, rarestPick, submitResult, topSharePct, type TodayStats } from '../../game/stats';
import { setAccent } from '../accents';
import { mountAd } from '../ads';
import { tipLink } from '../tip';
import { siteLinks } from '../siteLinks';
import { IS_PORTAL } from '../../portal';
import { clear, h, toast } from '../dom';
import { confetti } from '../confetti';
import { scoutCard } from '../scoutCard';
import type { PosterData } from '../poster';
import { emojiCard, copyText, posterFooter, sharePoster, type ShareContext } from '../share';
import { countdownLine, lineWith, streakChip } from '../dayCard';

export interface ResultCallbacks {
  onAgain: () => void;
  onFree: () => void;
  onHome: () => void;
  /** Opens the Stats dialog. The panel's 📊 button shows only when it is set (it ships with that dialog). */
  onStats?: () => void;
}

/**
 * The crowd lines under a scored daily. The first run of the day is told so;
 * under MIN_PUBLIC_SAMPLE runs the stats return no percent, so only the
 * counts show; a 0% beat line is left out.
 */
function globalLines(today: TodayStats, wins: number, lineup: Session['state']['lineup']): string[] {
  if (today.total <= 1) return [t('global.first')];
  const lines: string[] = [];
  const pct = percentileBeaten(wins, today.distribution);
  if (pct) lines.push(t('global.beat', { pct }));
  const num = new Intl.NumberFormat(getLocale());
  lines.push(t('global.counts', { total: num.format(today.total), invictos: num.format(today.invictos) }));
  const rare = rarestPick(today.yourPicks ?? [], today.total);
  const who = rare && Object.values(lineup).find((p) => p?.id === rare.id);
  if (rare && who) lines.push(t('global.rarest', { name: who.name, pct: rare.pct }));
  return lines;
}

/** newBadges: the badges this run earned for the first time (they pop). */
export function renderResult(app: HTMLElement, session: Session, run: RunResult, newBadges: BadgeId[], cb: ResultCallbacks): void {
  clear(app);
  app.dataset.screen = 'result';
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
  // A run is named by the day it was dealt, never the clock now: a daily
  // finished after midnight keeps its own number and date.
  const daily = session.mode === 'daily';
  const dailyNum = daily ? dailyNumber(session.day) : null;
  const practice = daily && !session.scored;
  const streak = daily && session.scored ? currentStreak(session.day) : 0;
  const footerLine = posterFooter(session.day, dailyNum, practice);

  const stageKey = run.outcome.startsWith('eliminated') ? run.outcome.replace('eliminated-', '') : null;
  const tierLine =
    run.outcome === 'invicto'
      ? t('share.tiers.invicto')
      : run.outcome === 'campeon'
        ? t('share.tiers.campeon', { record })
        : run.outcome === 'subcampeon'
          ? t('share.tiers.subcampeon', { record })
          : t('result.eliminatedShare', { stage: t(`result.stageShort.${stageKey}`), record });

  const shareCtx: ShareContext = { dailyNum, practice, hard: session.mode === 'hard', streak, tierLine, gameFlags };
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
  // topSharePct is null under the sample floor and outside the top half.
  let globalTopPct: number | null = null;
  const globalLine = () => (globalTopPct !== null ? t('global.top', { pct: globalTopPct }) : null);
  const extraLines = () => [globalLine(), badgeLine].filter(Boolean).join('\n') || null;
  const posterForShare = (): PosterData =>
    globalTopPct !== null ? { ...posterData, footer: `${footerLine}  ·  ${t('global.top', { pct: globalTopPct })}` } : posterData;
  const statsEl = h('div.result-meta.global-lines');
  // Portal builds have no stats backend (see title.ts).
  if (daily && session.scored && !IS_PORTAL) {
    const picks = SLOTS.map((slot) => session.state.lineup[slot]!.id);
    void submitResult({ day: session.day, wins: run.wins, losses: run.losses, outcome: run.outcome, picks }).then((today) => {
      if (!today) return;
      globalTopPct = topSharePct(run.wins, today.distribution);
      statsEl.append(...globalLines(today, run.wins, session.state.lineup).map((line) => h('div', {}, line)));
    });
  }

  // Today's daily again is practice; once the dealt day is over (a run that
  // crossed midnight, or midnight while this screen is up), the same button
  // deals the new day's scored daily, and says so.
  const againLabel = () =>
    !daily ? t('result.again') : session.day === todayKey() ? t('result.practiceAgain') : `⭐ ${t('title.dailyNum', { n: dailyNumber() })}`;
  const againBtn = h('button.btn', { onclick: cb.onAgain }, againLabel());

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
    againBtn,
    daily ? h('button.btn', { onclick: cb.onFree }, `⚾\uFE0F ${t('title.free')}`) : null,
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

  // The countdown runs only while its day is today: after midnight the next
  // challenge is already out, and the again button deals it.
  const countdown: HTMLElement | null =
    daily && session.day === todayKey()
      ? countdownLine(() => {
          countdown?.remove();
          againBtn.textContent = againLabel();
        })
      : null;
  const scoredToday = practice ? dailyResult(session.day) : null;
  const dailyPanel = daily
    ? h(
        'div.day-card.daily-panel',
        {},
        h(
          'div.day-card-top',
          {},
          h('div.eyebrow', {}, t('title.doneEyebrow', { n: dailyNumber(session.day) })),
          streak > 0 ? streakChip(streak, true) : null,
        ),
        practice ? h('div.day-line', {}, t('result.practice')) : null,
        scoredToday ? h('div.day-line', {}, ...lineWith('result.scoredAttempt', 'record', h('b', {}, scoredToday.record))) : null,
        countdown,
        cb.onStats ? h('div.day-actions', {}, h('button.chip-btn', { type: 'button', onclick: cb.onStats }, t('title.stats'))) : null,
      )
    : null;

  app.append(
    h(
      'div.result-screen',
      {},
      h('div', { style: 'height:14px' }),
      h(
        'div.result-grid',
        {},
        h('div.result-main', {}, posterEl, badgesEl, buttons),
        h('div.result-side', {}, dailyPanel, scoutCard(session, run), statsEl),
      ),
      tipLink() ? h('div.result-meta', {}, tipLink()) : null,
      daily ? h('div.result-meta', {}, t('result.dailyNote')) : null,
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
