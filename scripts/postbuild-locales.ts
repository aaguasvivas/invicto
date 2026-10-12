// Post-build: write the localized entry pages dist/en, dist/ja and dist/ko from
// the built root page, so a pasted link unfurls with its own language's preview
// card. The transform lives in scripts/lib/localizeHtml.ts (tested on the real
// index.html) and throws when the template stops matching, which fails the build.
//
// Runs automatically as part of `npm run build`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LOCALES, localizeHtml } from './lib/localizeHtml';

const root = readFileSync('dist/index.html', 'utf-8');

for (const locale of LOCALES) {
  mkdirSync(`dist/${locale}`, { recursive: true });
  writeFileSync(`dist/${locale}/index.html`, localizeHtml(root, locale));
  console.log(`dist/${locale}/index.html written`);
}
