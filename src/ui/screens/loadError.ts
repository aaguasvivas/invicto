// Shown when the roster data cannot be loaded (offline, captive portal, a
// stale service). Before this existed the game was a blank navy screen with
// nothing to do; now it says what happened and offers a retry.

import { t } from '../../i18n';
import { openDialog } from '../dialog';
import { h } from '../dom';

export function renderLoadError(onRetry: () => void): void {
  document.querySelector<HTMLDialogElement>('dialog.load-error')?.close();
  // The message is what the dialog is about, so it names it.
  const message = h('p.dialog-text', {}, t('boot.error'));
  const retry = h('button.btn.primary', { type: 'button', onclick: () => { dialog.close(); onRetry(); } }, t('boot.retry'));
  const dialog = openDialog({
    variant: 'load-error',
    heading: message,
    content: [h('div.big', { 'aria-hidden': 'true' }, '📡'), message, retry],
  });
}
