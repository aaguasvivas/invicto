// The six info pages (how to play, about, FAQ, privacy, terms, contact) are
// bilingual: Spanish first, then the English half under id="en". Anyone not
// playing in Spanish lands on the English half; the rosters have their own
// English tree instead of an anchor.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { FakeElement, installDom, installStorage } from '../test/fakedom';

afterEach(() => {
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage']) Reflect.deleteProperty(globalThis, name);
});

/** The footer link hrefs on a fresh page whose browser speaks this language. */
async function footerHrefs(browserLang: string): Promise<string[]> {
  vi.resetModules();
  installDom([browserLang]);
  installStorage();
  const nav = (await import('./siteLinks')).siteLinks() as unknown as FakeElement;
  return nav.querySelectorAll('a').map((a) => a.href);
}

/** The link hrefs of the crawlable info section below the game, localized on boot. */
async function landingHrefs(browserLang: string): Promise<string[]> {
  vi.resetModules();
  const { body } = installDom([browserLang]);
  installStorage();
  const section = new FakeElement('section');
  section.className = 'landing-info';
  body.append(section);
  (await import('./landing')).renderLandingInfo();
  return section.querySelectorAll('a').map((a) => a.href);
}

describe('footer links', () => {
  test('Spanish players open the info pages at the top, in Spanish', async () => {
    expect(await footerHrefs('es-ES')).toEqual([
      '/how-to-play.html', '/rosters/', '/faq.html', '/privacy.html', '/terms.html', '/contact.html',
    ]);
  });

  test('everyone else jumps to the English half, and gets the English rosters', async () => {
    for (const lang of ['en-US', 'ja-JP', 'ko-KR']) {
      expect(await footerHrefs(lang), lang).toEqual([
        '/how-to-play.html#en', '/en/rosters/', '/faq.html#en', '/privacy.html#en', '/terms.html#en', '/contact.html#en',
      ]);
    }
  });

  test('the info section below the game follows the same rule, About included', async () => {
    expect(await landingHrefs('es-ES')).toContain('/about.html');
    expect(await landingHrefs('ja-JP')).toEqual([
      '/how-to-play.html#en', '/en/rosters/', '/about.html#en', '/faq.html#en', '/privacy.html#en', '/terms.html#en', '/contact.html#en',
    ]);
  });
});
