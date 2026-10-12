// Invicto boot + screen routing.
//
// The title renders immediately; the roster data (~1.3MB) loads in the
// background and is only awaited when the player actually starts a run. A
// failed load shows a retry instead of a blank screen. Runs autosave after
// every pick so a reloaded tab can resume exactly where it was, and a finished
// run is saved before the sim reveal, so a reload cannot reopen the daily.
//
// A challenge link (#r=... on the site, the invite param r on CrazyGames) is
// read once at boot and dropped from the address bar. It waits on the title
// for Accept, which deals the friend's seed (game/challenge.ts says where each
// kind of link leads), and never starts a run by itself.

import './styles.css';
import { applyMeta, getLang, t } from './i18n';
import { depthOf, loadData, type GameData } from './game/data';
import { dailyNumber, dailyResult, todayKey, type Mode } from './game/state';
import { recordRun } from './game/finish';
import {
  challengeKind, isOwnChallenge, ownRun, parseChallenge, recordOf, resolveChallenge, seedDay, type ChallengeCode, type Rival,
} from './game/challenge';
import { lineup, newSession, playedSession, type Session } from './game/session';
import {
  clearRun, lineupComplete, loadRun, restoreSession, saveRun, snapshotSession, snapshotUsable, type RunSnapshot,
} from './game/resume';
import { openSlots } from './engine/draft';
import { SLOTS } from './engine/positions';
import { simulateRun } from './engine/simulate';
import type { LineupSlots } from './engine/types';
import { renderTitle, type TitleChallenge } from './ui/screens/title';
import { renderDraft, type DraftCallbacks } from './ui/screens/draft';
import { renderSim } from './ui/screens/sim';
import { renderResult } from './ui/screens/result';
import { renderLoadError } from './ui/screens/loadError';
import { renderLandingInfo } from './ui/landing';
import { toast } from './ui/dom';
import { challengeLink, shareText } from './ui/share';
import {
  portalGameplayStart, portalGameplayStop, portalHappytime, portalInit, portalInviteParam, portalLoadingStart, portalLoadingStop,
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
    depth: dataPromise.then((d) => depthOf(d.players)),
    resume: resumable
      ? {
          mode: resumable.mode,
          round: resumable.round,
          complete: lineupComplete(resumable),
          onResume: () => void resumeRun(resumable),
        }
      : undefined,
    challenge: incoming ? titleChallenge(incoming) : undefined,
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

/** deal: a challenge's rival, with its seed (and scoring) when the mode would not deal it by itself. */
async function startRun(mode: Mode, deal?: { rival: Rival; seed?: string; scored?: boolean }): Promise<void> {
  const d = await ready();
  if (!d) return;
  clearRun(); // a new run replaces any interrupted one
  enterGame();
  // Daily scores only the first attempt of the day; replays are practice.
  const scored = deal?.scored ?? (mode === 'daily' ? !dailyResult() : true);
  const session = newSession(d, mode, scored, deal?.seed);
  if (deal) session.rival = deal.rival;
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
  if (complete) runTournament(session, snap.savedAt);
  else renderDraft(app, session, draftCallbacks(session));
}

/** replayOf: the savedAt of a complete lineup's snapshot, whose run was saved before a reload cut its reveal. */
function runTournament(session: Session, replayOf?: number): void {
  resetScroll();
  const run = simulateRun(lineup(session), session.seed);
  // (lineup() returns the slot-keyed record; the engine gates pitching as its own category)
  // Saved now, not on the result screen: a reload during the reveal must find
  // the daily played. The same lineup and seed replay the same run.
  const newBadges = recordRun(session, run, replayOf);
  renderSim(app, run, session.data, session.state.lineup, () => {
    resetScroll();
    clearRun(); // the run is complete; nothing left to resume
    portalGameplayStop();
    if (run.outcome === 'invicto') portalHappytime();
    renderResult(app, session, run, newBadges, {
      onAgain: () => void startRun(session.mode), // one more run, zero friction
      onFree: () => void startRun('free'),
      onHome: showTitle,
    });
  }, session.rival);
}

// ---------------------------------------------------------------------------
// Challenge links

/**
 * A link opened at boot, on the title until Accept or Not now. own: it is this
 * device's own run. played: Accept opens the comparison (see playedRun). Both
 * are settled by vetIncoming once the rosters are in.
 */
let incoming: { code: ChallengeCode; own: boolean; played: boolean } | null = null;

/**
 * Take a #r= fragment off the address bar before anything else runs: a reload
 * must not offer the challenge again (resume covers reloads), and no script
 * after this one ever sees it. Browsers never send a fragment to a server.
 */
function takeLinkFragment(): string | null {
  const match = /^#r=(.+)$/.exec(location.hash);
  if (!match) return null;
  history.replaceState(history.state, '', location.pathname + location.search);
  return match[1];
}

/**
 * Once the rosters are in: a link whose picks are no real lineup is dropped,
 * silently; the device's own link turns into a prompt to share it; and a deal
 * played here stays played only while the rosters still hold its lineup, the
 * same test Accept makes. The title redraws only when one of these changes.
 */
async function vetIncoming(): Promise<void> {
  const pending = incoming;
  const d = await dataPromise.catch(() => null);
  if (!d || !pending || incoming !== pending) return;
  const rival = resolveChallenge(pending.code, d.players);
  const vetted = rival && { code: pending.code, own: isOwnChallenge(rival, ownRun(rival.seed)), played: playedRun(rival.seed, d) !== null };
  if (vetted && vetted.own === pending.own && vetted.played === pending.played) return;
  incoming = vetted;
  if (app.dataset.screen === 'title') showTitle();
}

function titleChallenge({ code, own, played }: { code: ChallengeCode; own: boolean; played: boolean }): TitleChallenge {
  const day = seedDay(code.seed);
  return {
    name: code.nick,
    record: recordOf(code.wins),
    kind: own ? 'own' : challengeKind(code.seed, todayKey(), dailyResult() !== null, played),
    dailyNum: day ? dailyNumber(day) : null,
    onAccept: () => void acceptChallenge(code),
    onDismiss: () => {
      incoming = null;
      showTitle();
    },
    onShare: () => void shareOwnLink(code),
  };
}

/** A run this device finished, rebuilt with today's rosters: what a comparison replays. */
interface PlayedRun {
  day: string;
  lineup: LineupSlots;
}

/**
 * This device's run of a seed, or null when it never finished that deal or
 * the rosters no longer hold one of its players: Accept then deals the run
 * afresh, and the title's chip says so.
 */
function playedRun(seed: string, d: GameData): PlayedRun | null {
  const run = ownRun(seed);
  if (!run) return null;
  const byId = new Map(d.players.map((p) => [p.id, p]));
  const lineup: LineupSlots = {};
  for (const [i, slot] of SLOTS.entries()) {
    const player = byId.get(run.ids[i]);
    if (!player) return null;
    lineup[slot] = player;
  }
  return { day: run.day, lineup };
}

async function acceptChallenge(code: ChallengeCode): Promise<void> {
  const d = await ready();
  if (!d) return;
  incoming = null;
  const rival = resolveChallenge(code, d.players);
  if (!rival) return showTitle(); // no real lineup: ignored
  const mine = playedRun(code.seed, d);
  const kind = challengeKind(code.seed, todayKey(), dailyResult() !== null, mine !== null);
  if (kind === 'compare') return showComparison(d, rival, mine!);
  // This deal is already in progress (Accept, then a reload): go on with it.
  const snap = loadRun();
  if (snap?.seed === code.seed && snapshotUsable(snap, todayKey())) return resumeRun({ ...snap, rival: code.raw });
  if (kind === 'daily' || kind === 'dailyPlayed') return startRun('daily', { rival });
  if (kind === 'past') return startRun('free', { rival, seed: code.seed, scored: false });
  return startRun(kind, { rival, seed: code.seed });
}

/** A deal this device already played: straight to the head-to-head. Nothing is saved, sent or earned again. */
function showComparison(d: GameData, rival: Rival, mine: PlayedRun): void {
  const session = playedSession(d, rival.seed, mine.day, mine.lineup);
  session.rival = rival;
  resetScroll();
  document.body.classList.add('in-game');
  renderResult(
    app,
    session,
    simulateRun(mine.lineup, rival.seed),
    [],
    { onAgain: () => void startRun(session.mode), onFree: () => void startRun('free'), onHome: showTitle },
    true,
  );
}

/** The device's own link, passed on: the dare and the link. */
async function shareOwnLink(code: ChallengeCode): Promise<void> {
  const link = await challengeLink(code.raw);
  if (link && (await shareText(`${t('challenge.shareLine')}\n${link}`)) === 'copied') toast(t('challenge.copied'));
}

async function boot(): Promise<void> {
  const fragment = takeLinkFragment(); // first, before any await
  await portalInit(); // in the CrazyGames build this can set the language
  document.documentElement.lang = getLang();
  applyMeta();
  const raw = fragment ?? (await portalInviteParam());
  const code = raw ? parseChallenge(raw) : null; // an invalid link is ignored
  // Until the rosters load, a run kept for this seed counts as played; vetIncoming checks it still rebuilds.
  incoming = code && { code, own: false, played: ownRun(code.seed) !== null };
  startLoading();
  if (incoming) void vetIncoming();
  showTitle();
}

void boot();
