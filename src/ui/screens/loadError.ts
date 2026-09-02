// Shown when the roster data cannot be loaded (offline, captive portal, a
// stale service). Before this existed the game was a blank navy screen with
// nothing to do; now it says what happened and offers a retry.

import { t } from '../../i18n';
import { h } from '../dom';

export function renderLoadError(onRetry: () => void): void {
  document.querySelector('.load-error')?.remove();
  const overlay = h(
    'div.howto-overlay.load-error',
    {},
    h(
      'div.howto-card',
      {},
      h('div.big', {}, '📡'),
      h('p', { style: 'color:var(--text);font-size:15px;line-height:1.5;margin:0 0 14px' }, t('boot.error')),
      h('button.btn.primary', { onclick: () => { overlay.remove(); onRetry(); } }, t('boot.retry')),
    ),
  );
  document.body.append(overlay);
}
