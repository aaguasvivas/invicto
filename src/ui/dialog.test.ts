// The one dialog helper behind the slot picker, How to play, About and the
// load error. The fake DOM stands in for the browser: showModal() opens,
// pressKey('Escape') cancels the topmost dialog the way a browser does, and
// focus is tracked, so these check the wiring that every overlay relies on.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import en from '../i18n/en.json';
import { activeElement, installDom, installStorage, pressKey, type FakeDom, type FakeElement } from '../test/fakedom';

let page: FakeDom;
let openDialog: typeof import('./dialog').openDialog;
let h: typeof import('./dom').h;

beforeEach(async () => {
  vi.resetModules();
  page = installDom(['en-US']);
  installStorage();
  ({ openDialog } = await import('./dialog'));
  ({ h } = await import('./dom'));
});

afterEach(() => {
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage']) Reflect.deleteProperty(globalThis, name);
});

const fake = (el: Element) => el as unknown as FakeElement;

/** A focused button on the page, as after a click or a Tab. */
function opener(): HTMLElement {
  const btn = h('button', {}, 'Open');
  page.app.append(fake(btn));
  btn.focus();
  return btn;
}

function open(extra: Partial<Parameters<typeof openDialog>[0]> = {}) {
  const heading = h('h2', {}, 'Where does Eduardo Paret play?');
  const first = h('button', {}, '1B');
  const second = h('button', {}, '2B');
  const dialog = openDialog({ heading, content: [heading, first, second], ...extra });
  return { dialog: fake(dialog), heading: fake(heading), first: fake(first), second: fake(second) };
}

const closeButton = (dialog: FakeElement) => dialog.querySelector('button.dialog-close')!;
const openDialogs = () => page.body.querySelectorAll('dialog');

describe('openDialog', () => {
  test('opens as a modal dialog named by its heading', () => {
    const { dialog, heading } = open();
    expect(dialog.open).toBe(true);
    expect(openDialogs()).toEqual([dialog]);
    expect(heading.id).not.toBe('');
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  test('gives each dialog its own heading id', () => {
    const a = open();
    const b = open();
    expect(a.heading.id).not.toBe(b.heading.id);
  });

  test('focuses the first button in its content', () => {
    const { first } = open();
    expect(activeElement()).toBe(first);
  });

  test('focuses the control it is given instead', () => {
    const given = h('button', {}, 'Next');
    const heading = h('h2', {}, 'How to play');
    openDialog({ heading, content: [heading, h('button', {}, 'Back'), given], focus: given });
    expect(activeElement()).toBe(fake(given));
  });

  test('with no button in its content, focuses its close button, which has a localized name', () => {
    const heading = h('h2', {}, 'About');
    const dialog = fake(openDialog({ heading, content: [heading, h('p', {}, 'Text')] }));
    expect(activeElement()).toBe(closeButton(dialog));
    expect(closeButton(dialog).getAttribute('aria-label')).toBe(en.dialog.close);
  });

  test('Escape closes it, removes it and returns focus to the control that opened it', () => {
    const trigger = fake(opener());
    open();
    pressKey('Escape');
    expect(openDialogs()).toHaveLength(0);
    expect(activeElement()).toBe(trigger);
  });

  test('the close button closes it and focus returns to the opener', () => {
    const trigger = fake(opener());
    const { dialog } = open();
    closeButton(dialog).click();
    expect(dialog.open).toBe(false);
    expect(openDialogs()).toHaveLength(0);
    expect(activeElement()).toBe(trigger);
  });

  test('a click on the backdrop closes it; a click inside does not', () => {
    const { dialog, heading } = open();
    heading.dispatch('pointerdown');
    heading.click();
    expect(dialog.open).toBe(true);
    // Outside the dialog box the event targets the <dialog> itself (its ::backdrop).
    dialog.dispatch('pointerdown');
    dialog.click();
    expect(dialog.open).toBe(false);
  });

  test('a press that starts inside and ends on the backdrop does not close it', () => {
    const { dialog, heading } = open();
    heading.dispatch('pointerdown'); // e.g. selecting text and releasing outside
    dialog.click();
    expect(dialog.open).toBe(true);
  });

  test('onClose runs once, after the dialog is gone', () => {
    const seen: number[] = [];
    const { dialog } = open({ onClose: () => seen.push(openDialogs().length) });
    pressKey('Escape');
    dialog.close();
    expect(seen).toEqual([0]);
  });

  test('when the opener is gone (the screen was redrawn), focus is left alone', () => {
    const trigger = fake(opener());
    const { dialog, first } = open();
    trigger.remove();
    first.focus();
    dialog.close();
    expect(activeElement()).toBe(page.body);
  });
});
