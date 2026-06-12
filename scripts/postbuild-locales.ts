// Post-build: generate localized entry points (dist/en, dist/ja, dist/ko) so a
// pasted link unfurls with the right language's preview card. Social scrapers
// read static HTML and never run the app's runtime localization — these pages
// are the fix. Each sets the app language (only when the visitor hasn't chosen
// one) and carries self-canonical + hreflang alternates.
//
// Runs automatically as part of `npm run build`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import en from '../src/i18n/en.json';
import ja from '../src/i18n/ja.json';
import ko from '../src/i18n/ko.json';

const ORIGIN = 'https://invictobaseball.com';

const LOCALES: { code: string; ogLocale: string; meta: { title: string; description: string } }[] = [
  { code: 'en', ogLocale: 'en_US', meta: en.meta },
  { code: 'ja', ogLocale: 'ja_JP', meta: ja.meta },
  { code: 'ko', ogLocale: 'ko_KR', meta: ko.meta },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const hreflangBlock = [
  `<link rel="alternate" hreflang="es" href="${ORIGIN}/" />`,
  ...LOCALES.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${ORIGIN}/${l.code}/" />`),
  `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/" />`,
].join('\n    ');

const root = readFileSync('dist/index.html', 'utf-8');

// Root (Spanish) page gets the hreflang cluster too.
writeFileSync('dist/index.html', root.replace('</head>', `    ${hreflangBlock}\n  </head>`));

for (const { code, ogLocale, meta } of LOCALES) {
  let html = root;
  html = html.replace('<html lang="es">', `<html lang="${code}">`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(meta.description)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(meta.title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(meta.description)}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(meta.title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(meta.description)}$2`);
  html = html.replace('<meta property="og:locale" content="es_419" />', `<meta property="og:locale" content="${ogLocale}" />`);
  html = html.replace('<meta property="og:locale:alternate" content="en_US" />', `<meta property="og:locale:alternate" content="es_419" />`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${ORIGIN}/${code}/$2`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${ORIGIN}/${code}/$2`);
  // Set the app language for first-time visitors (respect an existing choice).
  html = html.replace(
    '</head>',
    `    <script>try{localStorage.getItem('invicto.lang')||localStorage.setItem('invicto.lang','${code}')}catch(e){}</script>\n    ${hreflangBlock}\n  </head>`,
  );
  mkdirSync(`dist/${code}`, { recursive: true });
  writeFileSync(`dist/${code}/index.html`, html);
  console.log(`dist/${code}/index.html written`);
}
