// Tip jar (Ko-fi / Buy Me a Coffee). A calm, optional ask, the 82-0 model: no
// ads, just a "buy me a coffee" link. Renders nothing until TIP_JAR_URL is
// filled in (same disabled-until-configured pattern as ads.ts), so it never
// shows a dead link.

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
