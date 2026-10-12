// Simulation screen: bracket cards flip one at a time, and the pacing escalates
// with the stakes (after a short guard, a tap anywhere skips everything, even
// mid-beat). A 6-0 team gets a gold pre-reveal beat before the final: THE moment.
// With a rival from a challenge link, each card adds the rival's game at the
// same stage, and the gold beat says what the final means against them.

import type { GameResult, LineupSlots, RunResult, Stage } from '../../engine/types';
import type { Rival } from '../../game/challenge';
import { countryName, flavor, t } from '../../i18n';
import type { GameData } from '../../game/data';
import { setAccent } from '../accents';
import { clear, h } from '../dom';
import { crowdRoar, vibrate } from '../sound';
import { rivalName } from '../versus';

/** Delay before each card flips, by stage: anticipation grows with the stakes. */
const REVEAL_MS = { pool: 600, qf: 750, sf: 950, final: 1300 } as const;
const FINAL_BEAT_MS = 1800;
const SF_BEAT_MS = 400;
/** Taps this soon after the screen appears are the draft's last pick landing twice, not a skip. */
const SKIP_GUARD_MS = 400;
/** The mercy rule (a 10-run lead) ends a game after the 7th. */
const MERCY_INNINGS = 7;

/**
 * The star line under a game card. Two corrections happen here, at display
 * time, so the seeded engine's draws never change: a closer in a walk-off win
 * pitched a scoreless 9th and got the win, not a save, and a mercy game has no
 * 8th inning for a starter to pitch.
 */
export function heroLine(game: GameResult, lineup: LineupSlots): string | null {
  const hero = game.hero;
  const player = hero && lineup[hero.slot];
  if (!hero || !player) return null;
  const params: Record<string, string | number> = { name: player.name };
  if (hero.kind === 'slugger') Object.assign(params, { hr: hero.n1, rbi: hero.n2 });
  if (hero.kind === 'contact') Object.assign(params, { h: hero.n1, ab: hero.n2 });
  if (hero.kind === 'starter') Object.assign(params, { ip: game.mercy ? Math.min(hero.n1, MERCY_INNINGS) : hero.n1, k: hero.n2 });
  if (hero.kind === 'closer') Object.assign(params, { k: hero.n1 });
  const key = hero.kind === 'closer' && game.walkOff ? 'closerWin' : hero.kind;
  return t(`hero.${key}`, params);
}

/**
 * The rival's game at a stage: their score and mark (the mark alone when only
 * the claimed record is known), or that they never got this far.
 */
export function rivalLine(rival: Rival, stage: Stage, stages: readonly Stage[]): string {
  const name = rivalName(rival);
  const i = stages.indexOf(stage);
  if (i >= rival.wins.length) return `⚔️ ${t('challenge.simNotReached', { name })}`;
  const game = rival.run?.games[i];
  return `⚔️ ${name}: ${game ? `${game.teamScore}-${game.oppScore} ` : ''}${rival.wins[i] ? '✅' : '❌'}`;
}

export function renderSim(app: HTMLElement, run: RunResult, data: GameData, lineup: LineupSlots, onDone: () => void, rival?: Rival): void {
  clear(app);
  app.dataset.screen = 'sim';
  setAccent(null);

  const recordEl = h('div.sim-record', {}, '0-0');
  const stageEl = h('div.sim-stage-label', {}, t('sim.title'));
  const bracket = h('div.bracket');
  const screen = h('div.sim-screen', {}, recordEl, stageEl, bracket, h('div.skip-hint', {}, t('sim.skip')));
  app.append(screen);

  const stageOf = (s: Stage) => (s.startsWith('pool') ? 'pool' : s) as 'pool' | 'qf' | 'sf' | 'final';
  const allStages: Stage[] = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'qf', 'sf', 'final'];
  const cards = new Map<Stage, HTMLElement>();

  let lastSection = '';
  for (const stage of allStages) {
    const section = stageOf(stage);
    if (section !== lastSection) {
      bracket.append(h('div.bracket-section', {}, t(`sim.stages.${section}`)));
      lastSection = section;
    }
    const card = h('div.game-card.pending', {}, h('span.game-flag', {}, '⚾'), h('div.game-info', {}, h('div.game-flavor', {}, '· · ·')));
    cards.set(stage, card);
    bracket.append(card);
  }

  let wins = 0;
  let losses = 0;
  let finalBeatShown = false;
  let sfBeatShown = false;
  let beatLine: HTMLElement | null = null;

  const clearBeat = () => {
    beatLine?.remove();
    beatLine = null;
    for (const card of cards.values()) card.classList.remove('beat-gold', 'beat-soft');
  };

  const revealCard = (game: GameResult) => {
    const card = cards.get(game.stage)!;
    const country = data.countries.get(game.opponent.country)!;
    const oppName = countryName(country);
    const star = heroLine(game, lineup);
    clear(card);
    card.classList.remove('pending');
    card.classList.add(game.win ? 'win' : 'loss', 'reveal');
    card.append(
      h('span.game-flag', {}, country.flag),
      h(
        'div.game-info',
        {},
        h(
          'div.game-score',
          {},
          h('span' + (game.win ? '.w' : '.l'), {}, `${t('sim.you')} ${game.teamScore}`),
          h('span', { style: 'color:var(--text-dim)' }, ' · '),
          h('span', {}, `${oppName} ${game.oppScore}`),
        ),
        h('div.game-flavor', {}, flavor(game.flavorKey, game.flavorVariant, { opp: oppName, us: game.teamScore, them: game.oppScore })),
        star ? h('div.game-flavor.hero', {}, star) : null,
        rival ? h('div.game-flavor.rival', {}, rivalLine(rival, game.stage, allStages)) : null,
      ),
      h('span.game-result-badge', {}, game.win ? '✅' : '❌'),
    );
    if (game.win) wins++;
    else losses++;
    recordEl.textContent = `${wins}-${losses}`;
    stageEl.textContent = t(`sim.stages.${stageOf(game.stage)}`);
    if (game.stage === 'final') vibrate([30, 40, 30]);
    if (game.win) crowdRoar(game.stage === 'final' ? (finalBeatShown ? 1.7 : 1.4) : 0.9);
  };

  let next = 0;
  let timer = 0;
  const finish = () => {
    window.clearTimeout(timer);
    screen.removeEventListener('click', skipAll);
    setTimeout(onDone, 900);
  };
  const step = () => {
    if (next >= run.games.length) return finish();
    const game = run.games[next];
    if (game.stage === 'final' && wins === 6 && losses === 0 && !finalBeatShown) {
      finalBeatShown = true;
      const card = cards.get(game.stage)!;
      // Against a rival: win and you beat them, or (they went 7-0) win and you match them.
      const stakes = rival ? t(rival.wins.every(Boolean) ? 'challenge.simMatch' : 'challenge.simBeat', { name: rivalName(rival) }) : null;
      beatLine = h('div.beat-line', {}, t('sim.beatFinal'), stakes ? h('div.beat-rival', {}, stakes) : null);
      bracket.insertBefore(beatLine, card);
      card.classList.add('beat-gold');
      timer = window.setTimeout(step, FINAL_BEAT_MS);
      return;
    }
    if (game.stage === 'sf' && wins === 5 && losses === 0 && !sfBeatShown) {
      sfBeatShown = true;
      cards.get(game.stage)!.classList.add('beat-soft');
      timer = window.setTimeout(step, SF_BEAT_MS);
      return;
    }
    clearBeat();
    revealCard(game);
    next++;
    timer = window.setTimeout(step, next < run.games.length ? REVEAL_MS[stageOf(run.games[next].stage)] : REVEAL_MS.pool);
  };
  let skippable = false;
  const skipAll = () => {
    if (!skippable) return;
    window.clearTimeout(timer);
    clearBeat();
    while (next < run.games.length) revealCard(run.games[next++]);
    finish();
  };
  screen.addEventListener('click', skipAll);
  window.setTimeout(() => { skippable = true; }, SKIP_GUARD_MS);
  timer = window.setTimeout(step, 500);
}
