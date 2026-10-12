// The scouting report card on the result screen (the numbers come from
// game/scout.ts). Top to bottom: the Team OVR, the six category bars with the
// weak spot in red, what ten more points there would buy, one line per loss
// with its chance before the dice, best pick and weakest link, the odds of this
// bracket (after the explanation, never before), and a disclosure with this
// lineup's formula and the engine source. Hard Mode adds the ratings the draft
// kept hidden.

import { SLOTS } from '../engine/positions';
import { GAME_NOISE_SD, LOGISTIC_SCALE } from '../engine/simulate';
import { CAL_A, CAL_B, CATEGORIES, categoryBlend, type Category } from '../engine/teamRating';
import type { RunResult, Slot } from '../engine/types';
import { scoutReport, type Verdict } from '../game/scout';
import type { Session } from '../game/session';
import { countryName, t } from '../i18n';
import { IS_PORTAL } from '../portal';
import { h } from './dom';
import { ratingChip } from './ratingChip';

const ENGINE_SOURCE = 'https://github.com/aaguasvivas/invicto/blob/main/src/engine/';

const LOSS_KEYS: Record<Verdict, string> = { luck: 'scout.lossLuck', coin: 'scout.lossCoin', underdog: 'scout.lossUnderdog' };

/** A team rating with one decimal: the gains the card talks about are often under a point. */
const ovr = (n: number): string => n.toFixed(1);

/** A contribution with its sign, and a true minus sign. */
function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(1)}`;
}

/** A game's chance in whole percent; a game that was played is never shown as 0% or 100%. */
const gamePct = (p: number): string => String(Math.min(99, Math.max(1, Math.round(p * 100))));

/** Tournament odds: whole percent from 10%, one decimal under that, and "<0.1" below. */
function oddsPct(p: number): string {
  const pct = p * 100;
  if (pct >= 9.95) return String(Math.round(pct));
  return pct >= 0.05 ? pct.toFixed(1) : '<0.1';
}

/** A localized line with the named values in bold; a % right after a value stays with it. */
function rich(key: string, params: Record<string, string>, bold: string[]): (string | HTMLElement)[] {
  return t(key)
    .split(/(\{\w+\}%?)/)
    .filter(Boolean)
    .map((part) => {
      const m = /^\{(\w+)\}(%?)$/.exec(part);
      if (!m) return part;
      const text = params[m[1]] + m[2];
      return bold.includes(m[1]) ? h('b', {}, text) : text;
    });
}

export function scoutCard(session: Session, run: RunResult): HTMLElement {
  const { lineup } = session.state;
  const report = scoutReport(lineup, run, session.seed, session.data.players);
  const country = (code: string) => session.data.countries.get(code)!;
  const category = (c: Category) => t(`scout.cat.${c}`);
  const lev = report.leverage;

  const head = h(
    'div.scout-head',
    {},
    h('h2.eyebrow.scout-title', {}, t('scout.title')),
    h('div.scout-ovr-block', {}, h('div.scout-ovr-label', {}, t('scout.teamOvr')), h('div.scout-ovr.display', {}, ovr(report.ovr))),
  );

  // Bars are plain CSS widths on a 0 to 100 scale, the scale of every rating in the game.
  const bars = h(
    'div.scout-bars',
    {},
    ...CATEGORIES.map((c) => {
      const value = report.categories[c];
      const isGate = c === lev.gate;
      return h(
        `div.scout-row${isGate ? '.gate' : ''}`,
        {},
        h('span.scout-label', {}, category(c)),
        h(
          'span.scout-track',
          {},
          h('span.scout-fill', { style: `width:${Math.min(100, Math.max(0, value))}%` }, isGate ? h('span.scout-tag', {}, t('scout.gateTag')) : null),
        ),
        h('span.scout-value', {}, String(Math.round(value))),
      );
    }),
  );

  const leverage = h(
    'p.scout-text',
    {},
    ...rich(
      'scout.gate',
      {
        cat: category(lev.gate),
        n: String(Math.round(report.categories[lev.gate])),
        a: ovr(lev.now),
        b: ovr(lev.gateUp),
        best: category(lev.best),
        c: ovr(lev.bestUp),
      },
      ['a', 'b', 'c'],
    ),
  );

  const losses =
    report.losses.length > 0
      ? h(
          'div.scout-losses.scout-section',
          {},
          ...report.losses.map((loss) =>
            h(
              'div.scout-loss',
              {},
              h('span.scout-flag', { 'aria-hidden': 'true' }, country(loss.country).flag),
              h('span.scout-loss-text', {}, ...rich(LOSS_KEYS[loss.verdict], { opp: countryName(country(loss.country)), p: gamePct(loss.chance) }, ['p'])),
            ),
          ),
        )
      : null;

  const playerName = (slot: Slot) => {
    const p = lineup[slot]!;
    return h('span.scout-name', {}, `${country(p.country).flag} ${p.name}`);
  };
  const pick = (key: string, { slot, delta }: { slot: Slot; delta: number }, cls: string) =>
    h(`div.scout-pick${cls}`, {}, h('span.scout-pick-label', {}, t(key)), playerName(slot), h('span.scout-delta', {}, signed(delta)));
  const picks = h(
    'div.scout-picks.scout-section',
    {},
    pick('scout.bestPick', report.best, '.best'),
    pick('scout.weakLink', report.weakest, ''),
    h('p.scout-note', {}, t('scout.baseline')),
  );

  const reveal =
    session.mode === 'hard'
      ? h(
          'div.scout-reveal.scout-section',
          {},
          h('p.scout-reveal-title', {}, t('scout.hardReveal')),
          ...SLOTS.map((slot) => h('div.scout-reveal-row', {}, h('span.slot', {}, slot), playerName(slot), ratingChip(lineup[slot]!.rating))),
        )
      : null;

  const odds = h('p.scout-odds.scout-section', {}, ...rich('scout.odds', { t: oddsPct(report.title), i: oddsPct(report.invicto) }, ['t', 'i']));

  // The formula with this lineup's numbers, in the order of the bars above.
  const blend = categoryBlend(report.categories).toFixed(2);
  const formula = (...lines: string[]) => h('pre.scout-formula', {}, lines.join('\n'));
  const engine = h(
    'details.scout-engine',
    {},
    h('summary', {}, t('scout.howEngine')),
    h(
      'div.scout-engine-body',
      {},
      h('p.scout-step', {}, t('scout.engine.blend')),
      formula(`c = ${CATEGORIES.map((c) => report.categories[c].toFixed(1)).join('  ')}`, `(Σ c^−4 ÷ 6)^(−1/4) = ${blend}`),
      h('p.scout-step', {}, t('scout.engine.ovr')),
      formula(`OVR = ${CAL_A} + ${CAL_B} × ${blend} = ${ovr(report.ovr)}`),
      h('p.scout-step', {}, t('scout.engine.game')),
      formula(`P(win) = E[1 / (1 + e^(−x / ${LOGISTIC_SCALE}))]`, `x = OVR − rival + ${GAME_NOISE_SD}z,  z ~ N(0, 1)`),
      // Game portals allow no links out of the game.
      IS_PORTAL
        ? null
        : h(
            'div.scout-links',
            {},
            ...['teamRating.ts', 'simulate.ts'].map((file) =>
              h('a.chip-btn', { href: `${ENGINE_SOURCE}${file}`, target: '_blank', rel: 'noopener noreferrer' }, `${file} ↗`),
            ),
          ),
    ),
  );

  return h('section.scout-card', {}, head, bars, leverage, losses, picks, reveal, odds, engine);
}
