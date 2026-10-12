// The head-to-head card that opens the result of a run dealt by a challenge
// link (and the comparison of a deal played before). Top to bottom: both
// records with the winner in gold, the verdict and why, the seven games side
// by side, both Team OVRs, the picks you matched, and both lineups (open from
// 768 px). A rival known by the claimed record alone (the rosters changed
// since the link was made) shows the win and loss marks only.

import { SLOTS } from '../engine/positions';
import { scheduleOpponents } from '../engine/simulate';
import type { GameResult, LineupSlots, RunResult, Stage } from '../engine/types';
import { matchedPicks, recordOf, versus, type Rival } from '../game/challenge';
import type { GameData } from '../game/data';
import { t } from '../i18n';
import { h } from './dom';

const STAGES: readonly Stage[] = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'qf', 'sf', 'final'];

/** The rival as named in the link, or "your rival". */
export function rivalName(rival: Rival): string {
  return rival.name ?? t('challenge.rival');
}

/** "Game 3", "Quarters"... */
function stageLabel(stage: Stage): string {
  return stage.startsWith('pool') ? t('challenge.stages.pool', { n: stage.slice(5) }) : t(`challenge.stages.${stage}`);
}

/** A run differential with its sign, and a true minus sign. */
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** One side of a game: the mark and the score, or the mark alone; a game never reached is a dot. */
function gameCell(game: GameResult | undefined, won: boolean | undefined, withScore: boolean): HTMLElement {
  if (won === undefined) return h('td.out', {}, '·');
  const score = withScore && game ? ` ${game.teamScore}-${game.oppScore}` : '';
  return h(`td.${won ? 'w' : 'l'}`, {}, `${won ? '✅' : '❌'}${score}`);
}

/** action: the Send it back button, when this build can hand out a link. */
export function versusCard(run: RunResult, rival: Rival, data: GameData, lineup: LineupSlots, action: HTMLElement | null): HTMLElement {
  const name = rivalName(rival);
  const theirs = rival.run;
  const { result, tiebreak } = versus(run, rival);
  const side = (who: string, record: string, won: boolean) =>
    h(`div.vs-side.${result === 'tie' ? 'tie' : won ? 'win' : 'lose'}`, {}, h('div.vs-who', {}, who), h('div.vs-record', {}, record));

  const why = !theirs
    ? t('challenge.oldData')
    : tiebreak
      ? t('challenge.tiebreak', { us: signed(tiebreak.us), them: signed(tiebreak.them) })
      : result === 'tie'
        ? null
        : t('challenge.why');

  // The opponents come from the seed alone, so both runs met the same team at each stage.
  const schedule = scheduleOpponents(rival.seed);
  const rows = STAGES.map((stage, i) => {
    const flag = data.countries.get(schedule[i].opponent.country)?.flag ?? '';
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, h('span.vs-flag', { 'aria-hidden': 'true' }, flag), stageLabel(stage)),
      gameCell(run.games[i], run.games[i]?.win, theirs !== null),
      gameCell(theirs?.games[i], rival.wins[i], true),
    );
  });
  const ovr = (n: number, other: number) => h(`td${n > other ? '.best' : ''}`, {}, n.toFixed(1));
  const table = h(
    'table.vs-games',
    {},
    h('thead', {}, h('tr', {}, h('td'), h('th', { scope: 'col' }, t('challenge.you')), h('th', { scope: 'col' }, name))),
    h('tbody', {}, ...rows),
    theirs
      ? h(
          'tfoot',
          {},
          h('tr', {}, h('th', { scope: 'row' }, t('scout.teamOvr')), ovr(run.teamRating, theirs.teamRating), ovr(theirs.teamRating, run.teamRating)),
        )
      : null,
  );

  const pick = (slot: (typeof SLOTS)[number], from: LineupSlots) => {
    const p = from[slot]!;
    return h('span.vs-pick', {}, h('span.vs-pick-name', {}, p.name), h('span.ed', {}, `'${String(p.edition).slice(2)}`));
  };
  const lineups = rival.lineup
    ? h(
        'details.vs-lineups',
        // Open where there is room for it: a recruiter on a laptop sees the whole comparison without a tap.
        { open: window.matchMedia?.('(min-width: 768px)')?.matches === true },
        h('summary', {}, t('challenge.lineups')),
        h(
          'div.vs-lineup-rows',
          {},
          h('div.vs-lineup-row.head', {}, h('span'), h('span', {}, t('challenge.you')), h('span'), h('span', {}, name)),
          ...SLOTS.map((slot) => {
            const same = lineup[slot]?.id === rival.lineup![slot]?.id;
            return h(
              `div.vs-lineup-row${same ? '.same' : ''}`,
              {},
              h('span.slot', {}, slot),
              pick(slot, lineup),
              h('span.vs-same', { 'aria-hidden': 'true' }, same ? '=' : ''),
              pick(slot, rival.lineup!),
            );
          }),
        ),
      )
    : null;

  const verdictId = `vs-verdict-${rival.seed}`;
  return h(
    'section.vs-card',
    { 'aria-labelledby': verdictId },
    h('div.eyebrow', {}, `⚔️ ${t('challenge.eyebrow')}`),
    h(
      'div.vs-head',
      {},
      side(t('challenge.you'), `${run.wins}-${run.losses}`, result === 'won'),
      h('div.vs-mid', { 'aria-hidden': 'true' }, 'vs'),
      side(name, recordOf(rival.wins), result === 'lost'),
    ),
    h('h2.vs-verdict', { id: verdictId }, t(`challenge.${result}`, { name })),
    why ? h('p.vs-why', {}, why) : null,
    table,
    rival.lineup ? h('p.vs-matched', {}, t('challenge.matched', { n: matchedPicks(lineup, rival.lineup) })) : null,
    lineups,
    action,
  );
}
