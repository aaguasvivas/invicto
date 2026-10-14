// Your numbers: the daily history and the trophy case in one dialog. It opens
// from the 📊 header chip and the day card on the title, and from the daily
// panel on the result. Everything comes from what this device saved: the day
// keys (game/history.ts), the personal bests and the badges. It writes nothing
// and calls no network, so it works the same in the portal build.

import type { Outcome } from '../../engine/types';
import { BADGE_IDS, earnedBadges, type BadgeId } from '../../game/badges';
import { dailyEntries, dailyStats, type DailyEntry, type DailyStats } from '../../game/history';
import { dailyNumber, OUTCOME_RANK, personalBest, todayKey } from '../../game/state';
import { getLocale, t } from '../../i18n';
import { openDialog } from '../dialog';
import { h } from '../dom';

/** The chart's row for each way a daily ends (stats.tier.*). */
const TIER: Record<Outcome, string> = {
  'eliminated-pool': 'pool',
  'eliminated-qf': 'qf',
  'eliminated-sf': 'sf',
  subcampeon: 'final',
  campeon: 'campeon',
  invicto: 'invicto',
};

export interface StatsOptions {
  /** The day the numbers are as of, and whose daily the chart marks: today, or the day a result's run was dealt. */
  day?: string;
  /** The empty state's button: start today's daily. */
  onPlayDaily: () => void;
}

/** Open Your numbers. Focus starts on the close button, so the dialog reads from its top. */
export function showStats({ day = todayKey(), onPlayDaily }: StatsOptions): void {
  const entries = dailyEntries();
  const heading = h('h2.dialog-title', {}, t('stats.title'));
  const play = () => {
    dialog.close();
    onPlayDaily();
  };
  const dialog = openDialog({
    variant: 'stats',
    heading,
    content: [heading, ...(entries.length > 0 ? history(entries, day) : [empty(play)]), bests(), cabinet()],
    focus: 'close',
  });
}

/** The tiles and the chart. Streak comes right after Played, so a history with no title does not lead with a 0. */
function history(entries: DailyEntry[], day: string): HTMLElement[] {
  const stats = dailyStats(entries, day);
  const today = entries.find((e) => e.day === day)?.result.outcome ?? null;
  return [tiles(stats), chart(stats, today)];
}

function tiles(stats: DailyStats): HTMLElement {
  const num = new Intl.NumberFormat(getLocale());
  // The label is in the markup first, so a screen reader says "Streak 4"; CSS puts the number on top.
  const tile = (label: string, value: number, cls = '') => h('div.stat-tile', {}, h('dt', {}, label), h(`dd${cls}`, {}, num.format(value)));
  return h(
    'dl.stat-tiles',
    {},
    tile(t('stats.played'), stats.played),
    tile(t('stats.streak'), stats.streak, stats.streak > 0 ? '.gold' : ''),
    tile(t('stats.bestStreak'), stats.bestStreak),
    tile(t('stats.titlePct'), Math.round((100 * stats.titles) / stats.played)),
  );
}

/** One bar per way a daily ends, as long as its count against the longest; the marked day's bar is gold. */
function chart(stats: DailyStats, today: Outcome | null): HTMLElement {
  const most = Math.max(...OUTCOME_RANK.map((o) => stats.tiers[o]));
  const num = new Intl.NumberFormat(getLocale());
  const rows = OUTCOME_RANK.map((outcome) => {
    const n = stats.tiers[outcome];
    return h(
      `div.tier-row.${TIER[outcome]}${outcome === today ? '.today' : ''}`,
      {},
      h('span.tier-label', {}, t(`stats.tier.${TIER[outcome]}`)),
      h(`span.tier-bar${n === 0 ? '.zero' : ''}`, { style: `--share:${n / most}` }, num.format(n)),
    );
  });
  return h('section.stats-section', {}, h('h3.stats-head', {}, t('stats.chart')), h('div.tier-bars', {}, ...rows));
}

/** No scored daily yet: one line and the way to start one. */
function empty(play: () => void): HTMLElement {
  return h(
    'div.stats-empty',
    {},
    h('p', {}, t('stats.empty')),
    h('button.btn.primary', { type: 'button', onclick: play }, `⭐ ${t('title.dailyNum', { n: dailyNumber() })}`),
  );
}

/** The Free play and Hard Mode bests, a line each, once the mode has one. */
function bests(): HTMLElement | null {
  const line = (label: string, mode: 'free' | 'hard') => {
    const best = personalBest(mode);
    if (!best) return null;
    const won = best.outcome === 'campeon' || best.outcome === 'invicto';
    return h('div.best-row', {}, h('span', {}, label), h(`b${won ? '.won' : ''}`, {}, best.record));
  };
  const lines = [line(t('stats.freeBest'), 'free'), line(t('stats.hardBest'), 'hard')].filter((l): l is HTMLElement => l !== null);
  return lines.length > 0 ? h('div.stats-bests', {}, ...lines) : null;
}

/** All eight badges: earned ones in gold with the day they were first earned, the rest with what earns them. */
function cabinet(): HTMLElement {
  const earned = earnedBadges();
  const owned = BADGE_IDS.filter((id) => earned[id] !== undefined);
  return h(
    'section.stats-section',
    {},
    h('h3.stats-head', {}, h('span', {}, t('stats.cabinet')), h('span.stats-count', {}, `${owned.length}/${BADGE_IDS.length}`)),
    h('ul.trophies', {}, ...BADGE_IDS.map((id) => trophy(id, earned[id]))),
  );
}

function trophy(id: BadgeId, earnedAt: string | undefined): HTMLElement {
  const name = t(`badges.${id}.name`);
  const when = earnedAt === undefined ? null : new Date(earnedAt);
  // A date this version cannot read still shows the badge as earned, just undated.
  const dated = when !== null && !Number.isNaN(when.getTime());
  return h(
    `li.trophy${when ? '.earned' : ''}`,
    {},
    h('div.trophy-name', {}, when ? `🏅 ${name}` : name),
    h('div.trophy-desc', {}, t(`badges.${id}.desc`)),
    when
      ? dated
        ? h('div.trophy-when', {}, t('stats.earned', { date: new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(when) }))
        : null
      : h('div.trophy-when', {}, t('stats.notYet')),
  );
}
