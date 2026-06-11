// Invicto — boot + screen routing.

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

const app = document.querySelector<HTMLDivElement>('#app')!;

function showTitle(data: GameData): void {
  renderTitle(app, {
    onRerender: () => showTitle(data),
    onStart: (mode: Mode) => startRun(data, mode),
  });
}

function startRun(data: GameData, mode: Mode): void {
  // Daily scores only the first attempt of the day; replays are practice.
  const scored = mode === 'daily' ? !dailyResult() : true;
  const session = newSession(data, mode, scored);
  renderDraft(app, session, { onDone: () => runTournament(session) });
}

function runTournament(session: Session): void {
  const run = simulateRun(lineup(session), session.seed);
  // (lineup() returns the slot-keyed record; the engine gates pitching as its own category)
  renderSim(app, run, session.data, () => {
    renderResult(app, session, run, {
      onAgain: () => startRun(session.data, session.mode), // one more run, zero friction
      onHome: () => showTitle(session.data),
    });
  });
}

async function boot(): Promise<void> {
  document.documentElement.lang = getLang();
  applyMeta();
  const data = await loadData();
  showTitle(data);
}

void boot();
