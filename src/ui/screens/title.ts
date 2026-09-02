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
      h('span', {}, played ? t('title.dailyPractice') : `⭐ ${t('title.dailyNum', { n: dailyNumber() })}`),
    ),
    h('button.btn', { onclick: () => cb.onStart('free') }, `⚾ ${t('title.free')}`),
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

function showHowto(): void {
  const panels = howtoPanels();
  let active = 0;
  const dots = h('div.howto-dots', {}, ...panels.map((_, i) => h('span', { className: i === 0 ? 'on' : '' })));
  const strip = h(
    'div.howto-panels',
    {
      onscroll: (e: Event) => {
        const el = e.currentTarget as HTMLElement;
        const idx = Math.round(el.scrollLeft / el.clientWidth);
        if (idx !== active) {
          active = idx;
          dots.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i === idx));
        }
      },
    },
    ...panels.map((p) =>
      h('div.howto-panel', {}, h('div.big', {}, p.icon), h('h3', {}, p.title), h('p', {}, p.body)),
    ),
  );
  const overlay = h(
    'div.howto-overlay',
    { onclick: (e: Event) => { if (e.target === overlay) overlay.remove(); } },
    h('div.howto-card', {}, strip, dots, h('button.chip-btn', { style: 'margin-top:10px', onclick: () => overlay.remove() }, t('footer.close'))),
  );
  document.body.append(overlay);
}

function showAbout(): void {
  const overlay = h(
    'div.howto-overlay',
    { onclick: (e: Event) => { if (e.target === overlay) overlay.remove(); } },
    h(
      'div.howto-card',
      {},
      h('h3', { style: 'color:var(--gold-2);margin-bottom:10px' }, t('footer.about')),
      h('p', { style: 'color:var(--text-dim);font-size:14px;line-height:1.6;margin:0' }, t('footer.aboutText')),
      h('button.chip-btn', { style: 'margin-top:14px', onclick: () => overlay.remove() }, t('footer.close')),
    ),
  );
  document.body.append(overlay);
}
