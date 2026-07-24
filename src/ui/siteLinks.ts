// A compact links row to the static content + trust pages, shown in the SPA
// footer on the title and result screens. AdSense expects the privacy policy
// (and ideally terms/contact) reachable via clear navigation from the screens
// that serve ads, so these links live in the game shell, not only on the
// static pages. Links use .html so they resolve in dev too (production serves
// them at clean URLs via a transparent redirect).

import { t } from '../i18n';
import { h } from './dom';

const LINKS: [string, string][] = [
  ['/how-to-play.html', 'footer.howto'],
  ['/rosters/', 'footer.rosters'],
  ['/faq.html', 'footer.faq'],
  ['/privacy.html', 'footer.privacy'],
  ['/terms.html', 'footer.terms'],
  ['/contact.html', 'footer.contact'],
];

export function siteLinks(): HTMLElement {
  return h('nav.site-links', {}, ...LINKS.map(([href, key]) => h('a', { href }, t(key))));
}
