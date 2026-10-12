// One modal dialog for every overlay: the slot picker, How to play, About and
// the load error. The native <dialog> opened with showModal() brings the
// dialog role, a background that cannot be clicked or tabbed into, Escape and
// the top layer. This adds the rest: the name from the heading, a 44 px close
// button, closing from the backdrop, the first focus, and focus back on the
// control that opened it.

import { t } from '../i18n';
import { h } from './dom';

export interface DialogSpec {
  /** Names the dialog (aria-labelledby). It must be part of `content`. */
  heading: HTMLElement;
  content: (Node | null)[];
  /** Extra class on the <dialog>, e.g. 'sheet' docks it to the bottom on phones. */
  variant?: string;
  /** Focused on open. Default: the first button in `content`, else the close button. */
  focus?: HTMLElement;
  /** Runs once the dialog has closed and left the page, however it was closed. */
  onClose?: () => void;
}

const CROSS =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

let headingIds = 0;

/** Open a modal dialog; close it with dialog.close(). */
export function openDialog({ heading, content, variant, focus, onClose }: DialogSpec): HTMLDialogElement {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = variant ? `dialog ${variant}` : 'dialog';
  heading.id ||= `dialog-title-${++headingIds}`;
  dialog.setAttribute('aria-labelledby', heading.id);

  const body = h('div.dialog-body', {}, ...content);
  const closeBtn = h('button.dialog-close', {
    type: 'button',
    'aria-label': t('dialog.close'),
    innerHTML: CROSS,
    onclick: () => dialog.close(),
  });
  dialog.append(body, closeBtn);

  // Outside the box, events target the <dialog> itself (its ::backdrop). Close
  // only when the press also started there: a text selection released outside
  // is not a dismissal.
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => {
    pressedOutside = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && pressedOutside) dialog.close();
  });
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      // A pick or a retry may have redrawn the screen; then there is nothing to return to.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      onClose?.();
    },
    { once: true },
  );

  document.body.append(dialog);
  dialog.showModal();
  (focus ?? body.querySelector('button') ?? closeBtn).focus({ preventScroll: true });
  return dialog;
}
