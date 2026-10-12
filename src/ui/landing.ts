// The crawlable info section below the game (in index.html, outside #app so the
// app never clears it). index.html ships a static Spanish version so non-JS
// crawlers still read text; this localizes it to the player's language on boot
// and on every language switch. Googlebot runs JS, so each locale shows its own
// language while the static fallback keeps the page non-empty without JS.

import { t } from '../i18n';
import { infoPageHref, rostersHref } from './siteLinks';
import { clear, h } from './dom';

export function renderLandingInfo(): void {
  const el = document.querySelector<HTMLElement>('.landing-info');
  if (!el) return;
  const links: [string, string][] = [
    [infoPageHref('/how-to-play.html'), 'footer.howto'],
    [rostersHref(), 'footer.rosters'],
    [infoPageHref('/about.html'), 'footer.about'],
    [infoPageHref('/faq.html'), 'footer.faq'],
    [infoPageHref('/privacy.html'), 'footer.privacy'],
    [infoPageHref('/terms.html'), 'footer.terms'],
    [infoPageHref('/contact.html'), 'footer.contact'],
  ];
  clear(el);
  el.append(
    h('h2', {}, t('landing.heading')),
    h('p', {}, t('landing.intro')),
    h('nav.landing-links', {}, ...links.map(([href, key]) => h('a', { href }, t(key)))),
    h('p.landing-disclaimer', {}, t('footer.disclaimer')),
  );
}
