// Invicto boot + screen routing.

import './styles.css';
import { applyMeta, getLang } from './i18n';
import { loadData, type GameData } from './game/data';
import { dailyResult, type Mode } from './game/state';
import { lineup, newSession, type Session } from './game/session';
import { simulateRun } from './engine/simulate';
import { renderTitle } from './ui/screens/title';
import { renderDraft } from './ui/screens/draft';
import { renderSim } from './ui/screens/sim';
import { renderResult } from './ui/screens/result';
import { renderLandingInfo } from './ui/landing';
import {
  portalGameplayStart, portalGameplayStop, portalHappytime, portalInit, portalLoadingStart, portalLoadingStop,
} from './portal';

const app = document.querySelector<HTMLDivElement>('#app')!;

/** Fresh screens start at the top; a stale scroll position kills the reveal. */
function resetScroll(): void {
  window.scrollTo(0, 0);
}

function showTitle(data: GameData): void {
  resetScroll();
  portalGameplayStop();
  // The crawlable info section belongs to the landing/title view only.
  document.body.classList.remove('in-game');
  renderTitle(app, {
    onRerender: () => showTitle(data),
    onStart: (mode: Mode) => startRun(data, mode),
  });
  // Localize the below-the-fold info section to match the current language
  // (runs on boot, on return-to-title, and after a language switch).
  renderLandingInfo();
}

function startRun(data: GameData, mode: Mode): void {
  resetScroll();
  portalGameplayStart();
  document.body.classList.add('in-game');
  // Daily scores only the first attempt of the day; replays are practice.
  const scored = mode === 'daily' ? !dailyResult() : true;
  const session = newSession(data, mode, scored);
  renderDraft(app, session, { onDone: () => runTournament(session) });
}

function runTournament(session: Session): void {
  resetScroll();
  const run = simulateRun(lineup(session), session.seed);
  // (lineup() returns the slot-keyed record; the engine gates pitching as its own category)
  renderSim(app, run, session.data, session.state.lineup, () => {
    resetScroll();
    portalGameplayStop();
    if (run.outcome === 'invicto') portalHappytime();
    renderResult(app, session, run, {
      onAgain: () => startRun(session.data, session.mode), // one more run, zero friction
      onHome: () => showTitle(session.data),
    });
  });
}

async function boot(): Promise<void> {
  document.documentElement.lang = getLang();
  applyMeta();
  await portalInit();
  portalLoadingStart();
  const data = await loadData();
  portalLoadingStop();
  showTitle(data);
}

void boot();
