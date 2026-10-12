// Tip jar (Ko-fi / Buy Me a Coffee). A calm, optional ask: one "buy me a
// coffee" link on the title and result screens, beside the dormant AdSense
// slots (ads.ts). Renders nothing until TIP_JAR_URL is filled in (the same
// disabled-until-configured pattern as ads.ts), so it never shows a dead link,
// and nothing in a portal build.

import { t } from '../i18n';
import { IS_PORTAL } from '../portal';
import { h } from './dom';

// Paste your Ko-fi or Buy Me a Coffee URL here, e.g. 'https://ko-fi.com/invicto'.
export const TIP_JAR_URL = 'https://ko-fi.com/adelsonaguasvivas';

/** A tasteful tip-jar link; null when unconfigured or in a portal build
    (game portals disallow external links). */
export function tipLink(): HTMLElement | null {
  if (!TIP_JAR_URL || IS_PORTAL) return null;
  return h(
    'a.tip-link',
    { href: TIP_JAR_URL, target: '_blank', rel: 'noopener noreferrer' },
    t('tip.cta'),
  );
}
