// Turns the root (Spanish) index.html into the entry page of another language.
// Link scrapers and crawlers read static HTML and never run the game, so the
// title, descriptions, share card, canonical URL, structured data and landing
// section must already be in the page's language. Every edit has to match
// exactly once: a template change that a pattern no longer finds fails the
// build instead of shipping Spanish text under an English title.

import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import ko from '../../src/i18n/ko.json';

export type Locale = 'en' | 'ja' | 'ko';
export const LOCALES: Locale[] = ['en', 'ja', 'ko'];

/** The strings an entry page needs from a language table. */
interface Table {
  meta: { title: string; description: string; imageAlt: string };
  landing: { heading: string; intro: string };
  footer: { disclaimer: string; howto: string; rosters: string; about: string; faq: string; privacy: string; terms: string; contact: string };
}

const ORIGIN = 'https://invictobaseball.com';

const PAGES: Record<Locale, { ogLocale: string; table: Table }> = {
  en: { ogLocale: 'en_US', table: en },
  ja: { ogLocale: 'ja_JP', table: ja },
  ko: { ogLocale: 'ko_KR', table: ko },
};

/** The landing section's links as the game renders them for every language but Spanish (src/ui/landing.ts). */
const LANDING_LINKS: [href: string, label: keyof Table['footer']][] = [
  ['/how-to-play.html', 'howto'],
  ['/en/rosters/', 'rosters'],
  ['/about.html', 'about'],
  ['/faq.html', 'faq'],
  ['/privacy.html', 'privacy'],
  ['/terms.html', 'terms'],
  ['/contact.html', 'contact'],
];

/** Text for an element or a double-quoted attribute. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Text for a JSON string inside a <script> element. */
const jsonText = (s: string) => JSON.stringify(s).slice(1, -1).replace(/</g, '\\u003c');

/** The value of <meta name|property="key" content="...">, whatever whitespace separates the attributes. */
const metaContent = (attr: 'name' | 'property', key: string) =>
  new RegExp(`(?<=<meta\\s+${attr}="${key}"\\s+content=")[^"]*(?=")`);

/** Replace the one match of `pattern`, or throw when there is none or more than one. */
function replaceOnce(html: string, label: string, pattern: RegExp, value: string): string {
  const count = html.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
  if (count !== 1) throw new Error(`localizeHtml: expected one ${label}, found ${count}`);
  return html.replace(pattern, () => value);
}

function landingSection(t: Table): string {
  const links = LANDING_LINKS.map(([href, label]) => `  <a href="${href}">${esc(t.footer[label])}</a>`);
  const lines = [
    `<h2>${esc(t.landing.heading)}</h2>`,
    `<p>${esc(t.landing.intro)}</p>`,
    '<nav class="landing-links">',
    ...links,
    '</nav>',
    `<p class="landing-disclaimer">${esc(t.footer.disclaimer)}</p>`,
  ];
  return `\n${lines.map((line) => `      ${line}`).join('\n')}\n    `;
}

export function localizeHtml(rootHtml: string, locale: Locale): string {
  const { ogLocale, table } = PAGES[locale];
  const { title, description, imageAlt } = table.meta;
  const url = `${ORIGIN}/${locale}/`;
  const image = `${ORIGIN}/og-${locale}.jpg`;
  const edits: [label: string, pattern: RegExp, value: string][] = [
    ['<html lang>', /(?<=<html\s+lang=")[^"]*(?=")/, locale],
    ['<title>', /(?<=<title>)[^<]*(?=<\/title>)/, esc(title)],
    ['meta description', metaContent('name', 'description'), esc(description)],
    ['og:title', metaContent('property', 'og:title'), esc(title)],
    ['og:description', metaContent('property', 'og:description'), esc(description)],
    ['twitter:title', metaContent('name', 'twitter:title'), esc(title)],
    ['twitter:description', metaContent('name', 'twitter:description'), esc(description)],
    ['og:locale', metaContent('property', 'og:locale'), ogLocale],
    // This page's locale leaves the alternates and Spanish takes its place.
    [`og:locale:alternate ${ogLocale}`, new RegExp(`(?<=<meta\\s+property="og:locale:alternate"\\s+content=")${ogLocale}(?=")`), 'es_419'],
    ['og:url', metaContent('property', 'og:url'), url],
    ['canonical link', /(?<=<link\s+rel="canonical"\s+href=")[^"]*(?=")/, url],
    ['og:image', metaContent('property', 'og:image'), image],
    ['og:image:alt', metaContent('property', 'og:image:alt'), esc(imageAlt)],
    ['twitter:image', metaContent('name', 'twitter:image'), image],
    ['twitter:image:alt', metaContent('name', 'twitter:image:alt'), esc(imageAlt)],
    ['JSON-LD url', /(?<="url":\s*")[^"]*(?=")/, url],
    ['JSON-LD image', /(?<="image":\s*")[^"]*(?=")/, image],
    ['JSON-LD description', /(?<="description":\s*")[^"]*(?=")/, jsonText(description)],
    ['landing section', /(?<=<section\s+class="landing-info"[^>]*>)[\s\S]*?(?=<\/section>)/, landingSection(table)],
    // The page's language for this view only: a stored choice still wins, and nothing is stored.
    ['</head>', /(?=<\/head>)/, `  <script>window.__INVICTO_LANG='${locale}'</script>\n  `],
  ];
  return edits.reduce((html, [label, pattern, value]) => replaceOnce(html, label, pattern, value), rootHtml);
}
