// Which language the game starts in. An explicit choice (the switcher writes
// invicto.lang) always wins. The /en/, /ja/ and /ko/ entry pages only hint
// their language for that page view, so opening a shared /en/ link once never
// pins English for later visits to the Spanish root.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { installDom, installStorage } from '../test/fakedom';

afterEach(() => {
  for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage', '__INVICTO_LANG']) {
    Reflect.deleteProperty(globalThis, name);
  }
});

/** A page load: fresh modules, the browser's languages and, on a locale page, its hint. */
async function boot(languages: string[], hint?: string) {
  vi.resetModules();
  installDom(languages);
  Reflect.deleteProperty(globalThis, '__INVICTO_LANG');
  if (hint) globalThis.__INVICTO_LANG = hint;
  return import('./index');
}

describe('starting language', () => {
  test('with no stored choice and no hint, the browser languages decide, then English', async () => {
    installStorage();
    expect((await boot(['ko-KR'])).getLang()).toBe('ko');
    expect((await boot(['fr-FR', 'ja-JP'])).getLang()).toBe('ja');
    expect((await boot(['fr-FR'])).getLang()).toBe('en');
  });

  test('the page hint beats the browser languages', async () => {
    installStorage();
    expect((await boot(['es-DO'], 'en')).getLang()).toBe('en');
  });

  test('a stored choice beats the page hint', async () => {
    installStorage('none', new Map([['invicto.lang', 'ja']]));
    expect((await boot(['es-DO'], 'en')).getLang()).toBe('ja');
  });

  test('an unknown hint is ignored', async () => {
    installStorage();
    expect((await boot(['es-DO'], 'xx')).getLang()).toBe('es');
  });

  test('one /en/ landing on a Spanish browser leaves the root in Spanish', async () => {
    const saved = installStorage();
    expect((await boot(['es-DO'], 'en')).getLang()).toBe('en');
    expect(saved.has('invicto.lang')).toBe(false);
    expect((await boot(['es-DO'])).getLang()).toBe('es');
  });

  describe('a host platform locale (CrazyGames systemInfo.locale)', () => {
    test.each([
      ['es-ES', 'en-US', 'es'],
      ['es-419', 'ja-JP', 'es'],
      ['en-US', 'es-DO', 'en'],
      ['en_GB', 'ko-KR', 'en'],
      ['ja-JP', 'es-DO', 'ja'],
      ['ja', 'en-US', 'ja'],
      ['ko-KR', 'es-DO', 'ko'],
      ['pt-BR', 'es-DO', 'en'],
      ['fr', 'ja-JP', 'en'],
      ['zh-Hant-TW', 'ko-KR', 'en'],
    ])('%s on a %s browser starts in %s (English when we do not have the language)', async (locale, browser, lang) => {
      installStorage();
      const i18n = await boot([browser]);
      i18n.adoptHostLocale(locale);
      expect(i18n.getLang()).toBe(lang);
    });

    test('it is a default, not a choice: nothing is stored', async () => {
      const saved = installStorage();
      const i18n = await boot(['es-DO']);
      i18n.adoptHostLocale('ja-JP');
      expect(i18n.getLang()).toBe('ja');
      expect(saved.has('invicto.lang')).toBe(false);
    });

    test('a language picked in the game beats it', async () => {
      installStorage('none', new Map([['invicto.lang', 'ko']]));
      const i18n = await boot(['es-DO']);
      i18n.adoptHostLocale('ja-JP');
      expect(i18n.getLang()).toBe('ko');
    });

    test('no locale at all leaves the browser languages in charge', async () => {
      installStorage();
      const i18n = await boot(['ko-KR']);
      i18n.adoptHostLocale(undefined);
      i18n.adoptHostLocale('');
      expect(i18n.getLang()).toBe('ko');
    });

    test('the switcher starts over from it: the other major language comes first', async () => {
      installStorage();
      const i18n = await boot(['es-DO']);
      i18n.adoptHostLocale('en-US');
      expect(i18n.nextLangLabel()).toBe('Español');
      expect(i18n.cycleLang()).toBe('es');
      expect(i18n.cycleLang()).toBe('ja');
      expect(i18n.cycleLang()).toBe('ko');
      expect(i18n.cycleLang()).toBe('en');
    });
  });

  test('the switcher stores the choice, and it holds on every page after', async () => {
    const saved = installStorage();
    const i18n = await boot(['es-DO'], 'en');
    i18n.setLang('ko');
    expect(saved.get('invicto.lang')).toBe('ko');
    expect((await boot(['es-DO'])).getLang()).toBe('ko');
    expect((await boot(['es-DO'], 'en')).getLang()).toBe('ko');
  });
});
