// The crawlable info section below the game (in index.html, outside #app so the
// app never clears it). index.html ships a static Spanish version so non-JS
// crawlers still read text; this localizes it to the player's language on boot
// and on every language switch. Googlebot runs JS, so each locale shows its own
// language while the static fallback keeps the page non-empty without JS.

import { t } from '../i18n';
import { clear, h } from './dom';

const LINKS: [string, string][] = [
  ['/how-to-play.html', 'footer.howto'],
  ['/rosters/', 'footer.rosters'],
  ['/about.html', 'footer.about'],
  ['/faq.html', 'footer.faq'],
  ['/privacy.html', 'footer.privacy'],
  ['/terms.html', 'footer.terms'],
  ['/contact.html', 'footer.contact'],
];

export function renderLandingInfo(): void {
  const el = document.querySelector<HTMLElement>('.landing-info');
  if (!el) return;
  clear(el);
  el.append(
    h('h2', {}, t('landing.heading')),
    h('p', {}, t('landing.intro')),
    h('nav.landing-links', {}, ...LINKS.map(([href, key]) => h('a', { href }, t(key)))),
    h('p.landing-disclaimer', {}, t('footer.disclaimer')),
  );
}
