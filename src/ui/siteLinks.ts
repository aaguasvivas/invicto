// A compact links row to the static content + trust pages, shown in the SPA
// footer on the title and result screens. AdSense expects the privacy policy
// (and ideally terms/contact) reachable via clear navigation from the screens
// that serve ads, so these links live in the game shell, not only on the
// static pages. Links use .html so they resolve in dev too (production serves
// them at clean URLs via a transparent redirect).

import { getLang, t } from '../i18n';
import { IS_PORTAL } from '../portal';
import { h } from './dom';

/** The rosters reference exists as ES and EN trees; Spanish players get the
    Spanish tree, everyone else (en/ja/ko) the English one. */
export function rostersHref(): string {
  return getLang() === 'es' ? '/rosters/' : '/en/rosters/';
}

export function siteLinks(): HTMLElement | null {
  // Portal builds ship only the game; the website's pages do not exist there.
  if (IS_PORTAL) return null;
  const links: [string, string][] = [
    ['/how-to-play.html', 'footer.howto'],
    [rostersHref(), 'footer.rosters'],
    ['/faq.html', 'footer.faq'],
    ['/privacy.html', 'footer.privacy'],
    ['/terms.html', 'footer.terms'],
    ['/contact.html', 'footer.contact'],
  ];
  return h('nav.site-links', {}, ...links.map(([href, key]) => h('a', { href }, t(key))));
}
