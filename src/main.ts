// Invicto boot + screen routing.
//
// The title renders immediately; the roster data (~1.3MB) loads in the
// background and is only awaited when the player actually starts a run. A
// failed load shows a retry instead of a blank screen. Runs autosave after
// every pick so a reloaded tab can resume exactly where it was, and a finished
// run is saved before the sim reveal, so a reload cannot reopen the daily.

import './styles.css';
import { applyMeta, getLang, t } from './i18n';
import { loadData, type GameData } from './game/data';
import { dailyResult, todayKey, type Mode } from './game/state';
import { recordRun } from './game/finish';
import { lineup, newSession, type Session } from './game/session';
import { clearRun, loadRun, restoreSession, saveRun, snapshotSession, snapshotUsable, type RunSnapshot } from './game/resume';
import { openSlots } from './engine/draft';
import { simulateRun } from './engine/simulate';
import { renderTitle } from './ui/screens/title';
import { renderDraft, type DraftCallbacks } from './ui/screens/draft';
import { renderSim } from './ui/screens/sim';
import { renderResult } from './ui/screens/result';
import { renderLoadError } from './ui/screens/loadError';
import { renderLandingInfo } from './ui/landing';
import { toast } from './ui/dom';
import {
  portalGameplayStart, portalGameplayStop, portalHappytime, portalInit, portalLoadingStart, portalLoadingStop,
} from './portal';

const app = document.querySelector<HTMLDivElement>('#app')!;

// ---------------------------------------------------------------------------
// Data: kicked off at boot, awaited lazily.

let data: GameData | null = null;
let dataPromise: Promise<GameData>;

function startLoading(): void {
  portalLoadingStart();
  dataPromise = loadData();
  dataPromise
    .then((d) => {
      data = d;
    })
    .catch(() => {
      // surfaced by ready() when the player tries to start; never unhandled
    })
    .finally(portalLoadingStop);
}

/** The loaded data, or null after showing the retry screen. Hints if slow. */
async function ready(): Promise<GameData | null> {
  if (data) return data;
  const hint = window.setTimeout(() => toast(t('boot.loading')), 300);
  try {
    return await dataPromise;
  } catch {
    renderLoadError(() => {
      startLoading();
      showTitle();
    });
    return null;
  } finally {
    window.clearTimeout(hint);
  }
}

// ---------------------------------------------------------------------------
// Screens

/** Fresh screens start at the top; a stale scroll position kills the reveal. */
function resetScroll(): void {
  window.scrollTo(0, 0);
}

function enterGame(): void {
  resetScroll();
  portalGameplayStart();
  document.body.classList.add('in-game');
}

function showTitle(): void {
  resetScroll();
  portalGameplayStop();
  // The crawlable info section belongs to the landing/title view only.
  document.body.classList.remove('in-game');

  const snap = loadRun();
  const resumable = snap && snapshotUsable(snap, todayKey()) ? snap : null;
  if (snap && !resumable) clearRun(); // an older daily, no longer meaningful

  renderTitle(app, {
    onRerender: showTitle,
    onStart: (mode: Mode) => void startRun(mode),
    resume: resumable ? { mode: resumable.mode, round: resumable.round, onResume: () => void resumeRun(resumable) } : undefined,
  });
  // Localize the below-the-fold info section to match the current language
  // (runs on boot, on return-to-title, and after a language switch).
  renderLandingInfo();
}

function draftCallbacks(session: Session): DraftCallbacks {
  return {
    onDone: () => runTournament(session),
    onChange: () => saveRun(snapshotSession(session)),
  };
}

async function startRun(mode: Mode): Promise<void> {
  const d = await ready();
  if (!d) return;
  clearRun(); // a new run replaces any interrupted one
  enterGame();
  // Daily scores only the first attempt of the day; replays are practice.
  const scored = mode === 'daily' ? !dailyResult() : true;
  const session = newSession(d, mode, scored);
  renderDraft(app, session, draftCallbacks(session));
}

async function resumeRun(snap: RunSnapshot): Promise<void> {
  const d = await ready();
  if (!d) return;
  const session = restoreSession(snap, d);
  if (!session) {
    clearRun();
    showTitle();
    return;
  }
  const complete = openSlots(session.state).length === 0;
  // A daily finished elsewhere while this draft was open can only continue as
  // practice. A complete lineup is past that point: it replays its own run,
  // which was saved before the reload.
  if (session.mode === 'daily' && !complete) session.scored = !dailyResult(session.day);
  enterGame();
  if (complete) runTournament(session);
  else renderDraft(app, session, draftCallbacks(session));
}

function runTournament(session: Session): void {
  resetScroll();
  const run = simulateRun(lineup(session), session.seed);
  // (lineup() returns the slot-keyed record; the engine gates pitching as its own category)
  // Saved now, not on the result screen: a reload during the reveal must find
  // the daily played. The same lineup and seed replay the same run.
  const newBadges = recordRun(session, run);
  renderSim(app, run, session.data, session.state.lineup, () => {
    resetScroll();
    clearRun(); // the run is complete; nothing left to resume
    portalGameplayStop();
    if (run.outcome === 'invicto') portalHappytime();
    renderResult(app, session, run, newBadges, {
      onAgain: () => void startRun(session.mode), // one more run, zero friction
      onHome: showTitle,
    });
  });
}

async function boot(): Promise<void> {
  await portalInit(); // in the CrazyGames build this can set the language
  document.documentElement.lang = getLang();
  applyMeta();
  startLoading();
  showTitle();
}

void boot();
