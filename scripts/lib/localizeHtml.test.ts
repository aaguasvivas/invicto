// The /en/, /ja/ and /ko/ entry pages are the root index.html rewritten at build
// time. Link scrapers (LinkedIn, Slack, WhatsApp) and crawlers read this static
// HTML and never run the game, so every tag they read must already be in the
// page's language. These tests run the transform on the real index.html.

import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import ko from '../../src/i18n/ko.json';
import { installDom, installStorage, type FakeElement } from '../../src/test/fakedom';
import { LOCALES, localizeHtml, type Locale } from './localizeHtml';

const ROOT = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const ORIGIN = 'https://invictobaseball.com';
const TABLES = { en, ja, ko };
const OG_LOCALES = { es: 'es_419', en: 'en_US', ja: 'ja_JP', ko: 'ko_KR' };

/** The parts of the landing section a reader sees, from static HTML. */
function staticLanding(html: string) {
  const $ = load(html);
  const section = $('.landing-info');
  return {
    heading: section.find('h2').text(),
    intro: section.find('p').first().text(),
    links: section.find('.landing-links a').map((_, a) => `${$(a).attr('href')} ${$(a).text()}`).get(),
    disclaimer: section.find('.landing-disclaimer').text(),
  };
}

describe.each(LOCALES)('the /%s/ entry page', (code: Locale) => {
  const table = TABLES[code];
  const html = localizeHtml(ROOT, code);
  const $ = load(html);
  const meta = (attr: 'name' | 'property', key: string) => $(`meta[${attr}="${key}"]`).attr('content');
  const pageUrl = `${ORIGIN}/${code}/`;
  const image = `${ORIGIN}/og-${code}.jpg`;

  test('declares its language', () => {
    expect($('html').attr('lang')).toBe(code);
  });

  test('title, description and their share-card copies are in its language', () => {
    expect($('title').text()).toBe(table.meta.title);
    expect(meta('name', 'description')).toBe(table.meta.description);
    expect(meta('property', 'og:title')).toBe(table.meta.title);
    expect(meta('property', 'og:description')).toBe(table.meta.description);
    expect(meta('name', 'twitter:title')).toBe(table.meta.title);
    expect(meta('name', 'twitter:description')).toBe(table.meta.description);
  });

  test('carries none of the Spanish descriptions', () => {
    const root = load(ROOT);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
      expect(html).not.toContain(root(selector).attr('content'));
    }
    expect(html).not.toContain('Arma tu lineup');
  });

  test('points canonical, og:url and the structured data at itself', () => {
    expect(meta('property', 'og:url')).toBe(pageUrl);
    expect($('link[rel="canonical"]').attr('href')).toBe(pageUrl);
    const ld = JSON.parse($('script[type="application/ld+json"]').text());
    expect(ld.url).toBe(pageUrl);
    expect(ld.description).toBe(table.meta.description);
    expect(ld.image).toBe(image);
    expect(ld.inLanguage).toEqual(['es', 'en', 'ja', 'ko']);
  });

  test('shares its own banner, with size and alt text', () => {
    expect(meta('property', 'og:image')).toBe(image);
    expect(meta('name', 'twitter:image')).toBe(image);
    expect(meta('property', 'og:image:alt')).toBe(table.meta.imageAlt);
    expect(meta('name', 'twitter:image:alt')).toBe(table.meta.imageAlt);
    expect(meta('property', 'og:image:type')).toBe('image/jpeg');
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
    expect(meta('property', 'og:site_name')).toBe('Invicto');
  });

  test('names its og:locale and the other three as alternates', () => {
    expect(meta('property', 'og:locale')).toBe(OG_LOCALES[code]);
    const alternates = $('meta[property="og:locale:alternate"]').map((_, m) => $(m).attr('content')).get();
    const others = Object.entries(OG_LOCALES).filter(([lang]) => lang !== code).map(([, og]) => og);
    expect(alternates.sort()).toEqual(others.sort());
  });

  test('the landing section reads in its language', () => {
    const landing = staticLanding(html);
    expect(landing.heading).toBe(table.landing.heading);
    expect(landing.intro).toBe(table.landing.intro);
    expect(landing.links).toContain(`/en/rosters/ ${table.footer.rosters}`);
    expect(landing.disclaimer).toBe(table.footer.disclaimer);
  });

  test('hints its language for this page view and never stores it', () => {
    const inline = $('script:not([src]):not([type])').text();
    expect(inline).toContain(`window.__INVICTO_LANG='${code}'`);
    expect(html).not.toContain('localStorage');
  });

  test('keeps the icons and the hreflang cluster', () => {
    expect($('link[rel="icon"][href="/favicon.svg"]').length).toBe(1);
    expect($('link[rel="apple-touch-icon"]').attr('href')).toBe('/apple-touch-icon.png');
    const hreflang = $('link[rel="alternate"][hreflang]').map((_, l) => `${$(l).attr('hreflang')} ${$(l).attr('href')}`).get();
    expect(hreflang).toEqual([
      `es ${ORIGIN}/`,
      `en ${ORIGIN}/en/`,
      `ja ${ORIGIN}/ja/`,
      `ko ${ORIGIN}/ko/`,
      `x-default ${ORIGIN}/`,
    ]);
  });
});

describe('the transform fails loudly instead of shipping Spanish', () => {
  test('a tag split across lines still matches', () => {
    const reflowed = ROOT.replace(/<meta\s+name="description"\s+content="/, '<meta\n      name="description"\n      content="');
    expect(reflowed).not.toBe(ROOT);
    expect(load(localizeHtml(reflowed, 'en'))('meta[name="description"]').attr('content')).toBe(en.meta.description);
  });

  test('a missing tag throws and names it', () => {
    const broken = ROOT.replace(/<meta\s+property="og:description"[^>]*>/, '');
    expect(() => localizeHtml(broken, 'en')).toThrow(/og:description/);
  });

  test('a duplicated tag throws too', () => {
    const doubled = ROOT.replace('</head>', '<link rel="canonical" href="https://example.com/" />\n</head>');
    expect(() => localizeHtml(doubled, 'en')).toThrow(/canonical/);
  });
});

describe('the static landing section matches what the game renders', () => {
  afterEach(() => {
    for (const name of ['document', 'window', 'Node', 'scrollTo', 'navigator', 'localStorage', '__INVICTO_LANG']) {
      Reflect.deleteProperty(globalThis, name);
    }
  });

  test.each(LOCALES)('%s', async (code) => {
    vi.resetModules();
    installStorage();
    const { body } = installDom(['es-DO']);
    globalThis.__INVICTO_LANG = code;
    const section = document.createElement('section') as unknown as FakeElement;
    section.className = 'landing-info';
    body.append(section);
    const { renderLandingInfo } = await import('../../src/ui/landing');
    renderLandingInfo();

    const [heading, intro, nav, disclaimer] = section.children;
    const rendered = {
      heading: heading.textContent,
      intro: intro.textContent,
      links: nav.children.map((a) => `${a.href} ${a.textContent}`),
      disclaimer: disclaimer.textContent,
    };
    expect(staticLanding(localizeHtml(ROOT, code))).toEqual(rendered);
  });
});
