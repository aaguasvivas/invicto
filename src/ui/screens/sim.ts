// Simulation screen: bracket cards flip one at a time (~600ms, tap to skip).

import type { GameResult, RunResult, Stage } from '../../engine/types';
import { flavor, getLang, t } from '../../i18n';
import type { GameData } from '../../game/data';
import { clear, h } from '../dom';
import { crowdRoar } from '../sound';

const REVEAL_MS = 600;

export function renderSim(app: HTMLElement, run: RunResult, data: GameData, onDone: () => void): void {
  clear(app);

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
  const revealCard = (game: GameResult) => {
    const card = cards.get(game.stage)!;
    const country = data.countries.get(game.opponent.country)!;
    const oppName = getLang() === 'es' ? country.nameEs : country.nameEn;
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
          h('span', { style: 'color:var(--text-dim)' }, ' — '),
          h('span', {}, `${oppName} ${game.oppScore}`),
        ),
        h('div.game-flavor', {}, flavor(game.flavorKey, game.flavorVariant, { opp: oppName, us: game.teamScore, them: game.oppScore })),
      ),
      h('span.game-result-badge', {}, game.win ? '✅' : '❌'),
    );
    if (game.win) wins++;
    else losses++;
    recordEl.textContent = `${wins}-${losses}`;
    stageEl.textContent = t(`sim.stages.${stageOf(game.stage)}`);
    if (game.win) crowdRoar(game.stage === 'final' ? 1.4 : 0.9);
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
    revealCard(run.games[next++]);
    timer = window.setTimeout(step, REVEAL_MS);
  };
  const skipAll = () => {
    window.clearTimeout(timer);
    while (next < run.games.length) revealCard(run.games[next++]);
    finish();
  };
  screen.addEventListener('click', skipAll);
  timer = window.setTimeout(step, 500);
}
