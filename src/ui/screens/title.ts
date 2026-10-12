// Title screen: resume an interrupted run, daily challenge (primary), free
// play, hard mode, how-to, footer. Renders instantly; player data may still be
// loading in the background when it appears.

import { cycleLang, howtoPanels, nextLangLabel, t } from '../../i18n';
import { IS_PORTAL } from '../../portal';
import { earnedBadgeCount } from '../../game/badges';
import {
  currentStreak, dailyNumber, dailyResult, msUntilNextDay, personalBest, setSound, soundOn, todayKey, type Mode,
} from '../../game/state';
import { fetchToday } from '../../game/stats';
import { setAccent } from '../accents';
import { mountAd } from '../ads';
import { tipLink } from '../tip';
import { siteLinks } from '../siteLinks';
import { crowdRoar, unlockAudio } from '../sound';
import { openDialog } from '../dialog';
import { clear, h } from '../dom';

export interface TitleCallbacks {
  onStart: (mode: Mode) => void;
  onRerender: () => void;
  /** An interrupted run that can be picked up exactly where it left off. */
  resume?: { mode: Mode; round: number; onResume: () => void };
}

function modeLabel(mode: Mode): string {
  return mode === 'daily' ? t('title.daily') : mode === 'free' ? t('title.free') : t('title.hard');
}

export function renderTitle(app: HTMLElement, cb: TitleCallbacks): void {
  clear(app);
  setAccent(null);
  const played = dailyResult();
  const streak = currentStreak();
  const bestFree = personalBest('free');
  const bestHard = personalBest('hard');

  const header = h(
    'header.hdr',
    {},
    h('span.brand', {}, 'INVICTO'),
    h(
      'div.hdr-btns',
      {},
      h(
        'button.chip-btn',
        {
          'aria-label': 'sound',
          onclick: (e: Event) => {
            const on = !soundOn();
            setSound(on);
            // The toggle tap is the user gesture that unlocks audio on iOS; a
            // soft roar confirms it worked.
            if (on) {
              unlockAudio();
              crowdRoar(0.35);
            }
            (e.currentTarget as HTMLElement).textContent = on ? '🔊' : '🔇';
          },
        },
        soundOn() ? '🔊' : '🔇',
      ),
      h('button.chip-btn', { onclick: () => { cycleLang(); cb.onRerender(); } }, `🌐 ${nextLangLabel()}`),
    ),
  );

  const resume = cb.resume;
  const resumeBtn = resume
    ? h(
        'button.btn.primary',
        { onclick: resume.onResume },
        h(
          'span',
          {},
          t('title.resume'),
          h('span.sub', {}, `${t('draft.round', { n: Math.min(resume.round + 1, 12) })} · ${modeLabel(resume.mode)}`),
        ),
      )
    : null;

  const menu = h(
    'div.menu',
    {},
    resumeBtn,
    h(
      'button.btn' + (resume ? '' : '.primary'),
      { onclick: () => cb.onStart('daily') },
      played
        ? h('span', {}, t('title.dailyPractice'))
        : h('span', {}, `⭐ ${t('title.dailyNum', { n: dailyNumber() })}`, h('span.sub', {}, t('title.dailySub'))),
    ),
    h(
      'button.btn',
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

  const metaBits: string[] = [];
  if (played) {
    metaBits.push(t('title.playedToday', { record: played.record }));
    const ms = msUntilNextDay();
    metaBits.push(t('title.nextDaily', { h: Math.floor(ms / 3600000), m: Math.floor((ms % 3600000) / 60000) }));
  }
  if (streak > 0) metaBits.push(t('title.streak', { n: streak }));
  const badgeCount = earnedBadgeCount();
  if (badgeCount > 0) metaBits.push(t('title.badges', { n: badgeCount }));
  if (bestFree) metaBits.push(t('title.best', { record: bestFree.record }));
  if (bestHard) metaBits.push(t('title.bestHard', { record: bestHard.record }));

  const metaEl = h('div.menu-meta', {}, metaBits.join('  ·  '));
  // Portal builds have no stats backend; skip the call so portal QA sees no
  // failed requests (the site build keeps its global daily numbers).
  if (!IS_PORTAL) {
    void fetchToday(todayKey()).then((today) => {
      if (!today || today.total < 1) return;
      metaBits.push(t('global.counts', { total: today.total, invictos: today.invictos }));
      metaEl.textContent = metaBits.join('  ·  ');
    });
  }

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
      'div.title-screen',
      {},
      h(
        'div.logo-block',
        {},
        h('div.logo', {}, 'INVICTO'),
        h('div.tagline', {}, t('tagline')),
        h('div.flag-strip', {}, '🇻🇪 🇩🇴 🇵🇷 🇯🇵 🇺🇸 🇲🇽 🇨🇺 🇰🇷 🇳🇱 🇹🇼'),
      ),
      menu,
      metaEl,
      adBox,
      footer,
    ),
  );
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
