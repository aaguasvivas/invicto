// Title screen: daily challenge (primary), free play, hard mode, how-to, footer.

import { cycleLang, howtoPanels, nextLangLabel, t } from '../../i18n';
import { currentStreak, dailyNumber, dailyResult, personalBest, setSound, soundOn, todayKey, type Mode } from '../../game/state';
import { fetchToday } from '../../game/stats';
import { setAccent } from '../accents';
import { mountAd } from '../ads';
import { clear, h } from '../dom';

export interface TitleCallbacks {
  onStart: (mode: Mode) => void;
  onRerender: () => void;
}

export function renderTitle(app: HTMLElement, cb: TitleCallbacks): void {
  clear(app);
  setAccent(null);
  const played = dailyResult();
  const streak = currentStreak();
  const bestFree = personalBest('free');

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
            setSound(!soundOn());
            (e.currentTarget as HTMLElement).textContent = soundOn() ? '🔊' : '🔇';
          },
        },
        soundOn() ? '🔊' : '🔇',
      ),
      h('button.chip-btn', { onclick: () => { cycleLang(); cb.onRerender(); } }, `🌐 ${nextLangLabel()}`),
    ),
  );

  const menu = h(
    'div.menu',
    {},
    h(
      'button.btn.primary',
      { onclick: () => cb.onStart('daily') },
      h('span', {}, `⭐ ${t('title.dailyNum', { n: dailyNumber() })}`),
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
  if (played) metaBits.push(t('title.playedToday', { record: played.record }));
  if (streak > 0) metaBits.push(t('title.streak', { n: streak }));
  if (bestFree) metaBits.push(t('title.best', { record: bestFree.record }));

  const metaEl = h('div.menu-meta', {}, metaBits.join('  ·  '));
  void fetchToday(todayKey()).then((today) => {
    if (!today || today.total < 1) return;
    metaBits.push(t('global.counts', { total: today.total, invictos: today.invictos }));
    metaEl.textContent = metaBits.join('  ·  ');
  });

  const adBox = h('div.ad-box');
  mountAd(adBox, 'title');

  const footer = h(
    'footer.footer',
    {},
    h('div', {}, t('footer.disclaimer')),
    h('div', { style: 'margin-top:6px' }, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); showAbout(); } }, t('footer.about'))),
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
