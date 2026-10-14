// Title screen: a friend's challenge link when one was opened, resume an
// interrupted run, today's challenge (or, once it is played, the day card: its
// record, the streak and a live countdown), free play, hard mode, how-to,
// yesterday's daily against the scout, footer. Renders instantly; player data
// may still be loading in the background when it appears.

import { cycleLang, getLocale, howtoPanels, nextLangLabel, t } from '../../i18n';
import { IS_PORTAL } from '../../portal';
import { BADGE_IDS, earnedBadgeCount } from '../../game/badges';
import type { ChallengeKind } from '../../game/challenge';
import { currentStreak } from '../../game/history';
import { dailyNumber, dailyResult, personalBest, previousDayKey, setSound, soundOn, todayKey, type Mode, type StoredResult } from '../../game/state';
import { fetchToday, MIN_PUBLIC_SAMPLE } from '../../game/stats';
import { setAccent } from '../accents';
import { mountAd } from '../ads';
import { tipLink } from '../tip';
import { siteLinks } from '../siteLinks';
import { crowdRoar, unlockAudio } from '../sound';
import { openDialog } from '../dialog';
import { countdownLine, lineWith, streakChip } from '../dayCard';
import { clear, h } from '../dom';
import { showStats } from './stats';

export interface TitleCallbacks {
  onStart: (mode: Mode) => void;
  onRerender: () => void;
  /** What the rosters hold, once they have loaded (the depth line). */
  depth: Promise<{ players: number; countries: number; editions: number }>;
  /**
   * An interrupted run that can be picked up exactly where it left off.
   * complete: all 12 picks are in, so the run is saved and only its reveal is left.
   */
  resume?: { mode: Mode; round: number; complete: boolean; onResume: () => void };
  /** A friend's challenge link, waiting for Accept or Not now. It never starts a run by itself. */
  challenge?: TitleChallenge;
}

export interface TitleChallenge {
  name: string | null;
  record: string;
  /** what Accept does, or 'own': the link is this device's own run, to share on */
  kind: ChallengeKind | 'own';
  /** a daily seed's challenge number */
  dailyNum: number | null;
  onAccept: () => void;
  onDismiss: () => void;
  onShare: () => void;
}

function modeLabel(mode: Mode): string {
  return mode === 'daily' ? t('title.daily') : mode === 'free' ? t('title.free') : t('title.hard');
}

export function renderTitle(app: HTMLElement, cb: TitleCallbacks): void {
  clear(app);
  app.dataset.screen = 'title';
  setAccent(null);
  const resume = cb.resume;
  // A saved run whose reveal is still to watch: nothing here may give its result away.
  const revealPending = resume?.complete === true;
  const onStats = revealPending ? undefined : () => showStats({ onPlayDaily: () => cb.onStart('daily') });
  const played = dailyResult();
  const streak = currentStreak();
  const challenge = cb.challenge ? challengeCard(cb.challenge) : null;
  // The challenge's Accept is then the one gold button on the screen.
  const gold = (primary: boolean) => (primary && !challenge ? '.primary' : '');

  const sound = h(
    'button.chip-btn',
    {
      type: 'button',
      'aria-label': t('a11y.sound'),
      'aria-pressed': String(soundOn()),
      onclick: () => {
        const on = !soundOn();
        setSound(on);
        // The toggle tap is the user gesture that unlocks audio on iOS; a
        // soft roar confirms it worked.
        if (on) {
          unlockAudio();
          crowdRoar(0.35);
        }
        sound.textContent = on ? '🔊' : '🔇';
        sound.setAttribute('aria-pressed', String(on));
      },
    },
    soundOn() ? '🔊' : '🔇',
  );
  // The wordmark is the hero below; the header holds only the chips.
  const header = h(
    'header.hdr',
    {},
    h(
      'div.hdr-btns',
      {},
      onStats ? h('button.chip-btn', { type: 'button', 'aria-label': t('stats.title'), onclick: onStats }, '📊') : null,
      sound,
      h('button.chip-btn', { type: 'button', onclick: () => { cycleLang(); cb.onRerender(); } }, `🌐 ${nextLangLabel()}`),
    ),
  );

  const resumeBtn = resume
    ? h(
        'button.btn' + gold(true),
        { onclick: resume.onResume },
        h(
          'span',
          {},
          resume.complete ? t('title.watch') : t('title.resume'),
          h(
            'span.sub',
            {},
            `${resume.complete ? t('title.lineupSet') : t('draft.round', { n: resume.round + 1 })} · ${modeLabel(resume.mode)}`,
          ),
        ),
      )
    : null;

  const menu = h(
    'div.menu',
    {},
    challenge,
    resumeBtn,
    played
      ? doneCard(played, streak, revealPending && resume?.mode === 'daily', cb, onStats)
      : h(
          'button.btn' + gold(!resume),
          { onclick: () => cb.onStart('daily') },
          h('span', {}, `⭐ ${t('title.dailyNum', { n: dailyNumber() })}`, h('span.sub', {}, t('title.dailySub'))),
        ),
    h(
      'button.btn' + gold(played !== null && !resume),
      { onclick: () => cb.onStart('free') },
      // U+FE0F asks for the color emoji; Japanese fonts otherwise draw an outline ball.
      h('span', {}, `⚾\uFE0F ${t('title.free')}`, h('span.sub', {}, t('title.freeSub'))),
    ),
    h(
      'button.btn',
      { onclick: () => cb.onStart('hard') },
      h('span', {}, t('title.hard'), h('span.sub', {}, t('title.hardSub'))),
    ),
    h('button.chip-btn', { style: 'align-self:center;margin-top:4px', onclick: () => showHowto() }, t('title.howto')),
  );

  // The streak is alive but today is unplayed, so the last daily was yesterday.
  const streakRisk = !played && streak > 0 ? h('p.streak-risk', {}, t('title.streakRisk', { n: streak })) : null;

  const adBox = h('div.ad-box');
  mountAd(adBox, 'title');

  const footer = h(
    'footer.footer',
    {},
    tipLink() ? h('div', { style: 'margin-bottom:10px' }, tipLink()) : null,
    h('div', {}, t('footer.disclaimer')),
    h('div', { style: 'margin-top:6px' }, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); showAbout(); } }, t('footer.about'))),
    siteLinks(),
  );

  app.append(
    header,
    h(
      'div.title-screen' + (challenge ? '.with-challenge' : ''),
      {},
      h(
        'div.logo-block',
        {},
        h('div.logo', {}, 'INVICTO'),
        h('div.tagline', {}, t('tagline')),
        h('div.flag-strip', {}, '🇻🇪 🇩🇴 🇵🇷 🇯🇵 🇺🇸 🇲🇽 🇨🇺 🇰🇷 🇳🇱 🇹🇼'),
      ),
      menu,
      revealPending ? null : yesterdayStrip(),
      streakRisk,
      revealPending ? null : statusChips(),
      metaLine(cb.depth),
      adBox,
      footer,
    ),
  );
}

/** What Accept does with the link, in the words of the menu it skips. */
function modeChip(kind: ChallengeKind, n: number): string {
  switch (kind) {
    case 'free':
      return `⚾\uFE0F ${t('title.free')}`;
    case 'hard':
      return t('title.hard');
    case 'daily':
      return `⭐ ${t('challenge.dailyChip', { n })}`;
    case 'dailyPlayed':
      return t('draft.practiceNote');
    case 'past':
      return t('challenge.pastChip', { n });
    case 'compare':
      return t('challenge.playedChip');
  }
}

/**
 * A friend's challenge: who sent it, their record on this deal and what
 * Accept does. Spoiler-safe: the record, never the picks. The device's own
 * link asks to be shared instead.
 */
function challengeCard(c: TitleChallenge): HTMLElement {
  const record = h('span.challenge-record', {}, c.record);
  const { kind } = c;
  const own = kind === 'own';
  const headline = own
    ? [t('challenge.own')]
    : c.name
      ? lineWith('challenge.headline', 'record', record, { name: c.name })
      : lineWith('challenge.anonymous', 'record', record);
  return h(
    'section.challenge-card',
    { 'aria-labelledby': 'challenge-headline' },
    h('div.eyebrow', {}, `⚔️ ${t('challenge.eyebrow')}`),
    h('h2.challenge-headline', { id: 'challenge-headline' }, ...headline),
    own ? null : h('p.challenge-sub', {}, t('challenge.sub')),
    own ? null : h(`div.challenge-chip${kind === 'daily' ? '.counts' : ''}`, {}, modeChip(kind, c.dailyNum ?? 0)),
    h('button.btn.primary', { onclick: own ? c.onShare : c.onAccept }, own ? t('challenge.button') : t('challenge.accept')),
    h('button.challenge-dismiss', { type: 'button', onclick: c.onDismiss }, t('challenge.dismiss')),
  );
}

/**
 * Today's challenge once it is played: the record, the streak and the
 * countdown to the next one, then Stats and Practice. pending: the run is
 * saved but its reveal is still to watch, so the card keeps the record back
 * and offers no practice run (starting one would throw the reveal away).
 */
function doneCard(played: StoredResult, streak: number, pending: boolean, cb: TitleCallbacks, onStats?: () => void): HTMLElement {
  const won = played.outcome === 'invicto' || played.outcome === 'campeon';
  return h(
    'div.day-card.daily-done',
    {},
    h(
      'div.day-card-top',
      {},
      h(
        'div',
        {},
        h('div.eyebrow', {}, t('title.doneEyebrow', { n: dailyNumber() })),
        pending
          ? h('div.day-line', {}, t('title.donePending'))
          : h(
              'div.day-record' + (won ? '.won' : ''),
              {},
              h('span.display', {}, played.record),
              h('span.day-tier', {}, t(`result.${played.outcome}`)),
            ),
      ),
      streak > 0 ? streakChip(streak) : null,
    ),
    countdownLine(cb.onRerender),
    pending
      ? null
      : h(
          'div.day-actions',
          {},
          onStats ? h('button.chip-btn', { type: 'button', onclick: onStats }, t('title.stats')) : null,
          h('button.chip-btn', { type: 'button', onclick: () => cb.onStart('daily') }, t('title.practice')),
        ),
  );
}

/**
 * Yesterday's daily against the scout, in one line. It reads only what the
 * result screen saved with the day (game/state.ts saveDailyGrade), so nothing
 * is computed here, and a day saved before grades existed shows nothing.
 */
function yesterdayStrip(): HTMLElement | null {
  const day = previousDayKey(todayKey());
  const played = dailyResult(day);
  if (!played?.grade || !played.par) return null;
  const par = `${played.par.wins}-${played.par.losses}`;
  return h('p.yesterday-strip', {}, t('scout.yesterday', { n: dailyNumber(day), record: played.record, par, g: played.grade }));
}

/** A returning player's numbers, one unbreakable chip each (a record never splits at its hyphen). */
function statusChips(): HTMLElement | null {
  const bestFree = personalBest('free');
  const bestHard = personalBest('hard');
  const badges = earnedBadgeCount();
  const chips = [
    bestFree ? t('title.best', { record: bestFree.record }) : null,
    bestHard ? t('title.bestHard', { record: bestHard.record }) : null,
    badges > 0 ? t('title.badges', { n: badges, total: BADGE_IDS.length }) : null,
  ].filter((chip): chip is string => chip !== null);
  return chips.length > 0 ? h('div.meta-chips', {}, ...chips.map((chip) => h('span.meta-chip', {}, chip))) : null;
}

/**
 * The line under the menu: today's crowd from MIN_PUBLIC_SAMPLE runs on,
 * otherwise what the game holds. Its box keeps its height while it loads.
 */
function metaLine(depth: TitleCallbacks['depth']): HTMLElement {
  const el = h('div.menu-meta');
  const num = new Intl.NumberFormat(getLocale());
  let counts: string | null = null;
  let held: string | null = null;
  const paint = () => {
    el.textContent = counts ?? held ?? '';
  };
  depth.then(
    (d) => {
      held = t('title.depth', { players: num.format(d.players), countries: num.format(d.countries), editions: num.format(d.editions) });
      paint();
    },
    () => {}, // no rosters, no line: starting a run shows the retry screen
  );
  // Portal builds have no stats backend; skip the call so portal QA sees no
  // failed requests.
  if (!IS_PORTAL) {
    void fetchToday(todayKey()).then((today) => {
      if (!today || today.total < MIN_PUBLIC_SAMPLE) return;
      counts = t('global.counts', { total: num.format(today.total), invictos: num.format(today.invictos) });
      paint();
    });
  }
  return el;
}

/** The rules as a stepper: swipe on touch, or Back, Next, the dots and the arrow keys. */
function showHowto(): void {
  const panels = howtoPanels();
  const last = panels.length - 1;
  let active = 0;

  const panelEls = panels.map((p) =>
    h('div.howto-panel', {}, h('div.big', { 'aria-hidden': 'true' }, p.icon), h('h3', {}, p.title), h('p', {}, p.body)),
  );
  // Positioned, so each panel's offsetLeft is its scroll position (the 16 px gaps included).
  const strip = h('div.howto-panels', {}, ...panelEls);
  const dots = panels.map((_, i) =>
    h('button.howto-dot', { type: 'button', 'aria-label': t('howto.step', { n: i + 1, total: panels.length }), onclick: () => go(i) }),
  );
  const back = h(
    'button.chip-btn.howto-back',
    { type: 'button', onclick: () => go(active - 1) },
    h('span', { 'aria-hidden': 'true' }, '‹'),
    t('howto.back'),
  );
  const next = h('button.chip-btn.howto-next', {
    type: 'button',
    onclick: () => (active === last ? dialog.close() : go(active + 1)),
  });

  const show = (i: number) => {
    active = i;
    dots.forEach((dot, j) => {
      dot.classList.toggle('on', j === i);
      if (j === i) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    // Back hides on the first panel; keep the keyboard on the stepper when it does.
    if (i === 0 && document.activeElement === back) next.focus({ preventScroll: true });
    back.classList.toggle('off', i === 0);
    clear(next);
    if (i === last) next.append(t('dialog.close'));
    else next.append(t('howto.next'), h('span', { 'aria-hidden': 'true' }, '›'));
  };
  const go = (i: number) => {
    const target = Math.max(0, Math.min(last, i));
    show(target);
    strip.scrollTo({ left: panelEls[target].offsetLeft }); // smooth unless reduced motion (styles.css)
  };
  // A swipe: follow the panel the strip snapped to, once it has settled.
  let settle = 0;
  strip.addEventListener('scroll', () => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      const offsets = panelEls.map((el) => Math.abs(el.offsetLeft - strip.scrollLeft));
      show(offsets.indexOf(Math.min(...offsets)));
    }, 80);
  });
  show(0);

  const heading = h('h2.dialog-title', {}, t('title.howto'));
  const dialog = openDialog({
    variant: 'howto',
    heading,
    content: [heading, strip, h('div.howto-nav', {}, back, h('div.howto-dots', {}, ...dots), next)],
    focus: next,
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(active + 1);
    else if (e.key === 'ArrowLeft') go(active - 1);
    else return;
    e.preventDefault(); // the strip would scroll a few pixels on its own
  });
}

function showAbout(): void {
  const heading = h('h2.dialog-title', {}, t('footer.about'));
  openDialog({ heading, content: [heading, h('p.dialog-text', {}, t('footer.aboutText'))] });
}
