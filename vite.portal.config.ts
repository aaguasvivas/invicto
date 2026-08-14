// Build config for the CrazyGames submission bundle (npm run build:crazygames).
// Produces a self-contained dist-crazygames/ that runs from any subpath on
// their CDN: relative asset base, only the data + font assets the game needs
// (none of the website's SEO/content pages), and portal.html renamed to
// index.html. The main site build (vite.config.ts) is untouched.

import { defineConfig } from 'vite';
import { cpSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  publicDir: false,
  define: { 'import.meta.env.VITE_PORTAL': JSON.stringify('crazygames') },
  build: {
    outDir: 'dist-crazygames',
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'portal.html') },
  },
  plugins: [
    {
      name: 'portal-package',
      closeBundle() {
        const out = 'dist-crazygames';
        cpSync('public/data', `${out}/data`, { recursive: true });
        cpSync('public/fonts', `${out}/fonts`, { recursive: true });
        renameSync(`${out}/portal.html`, `${out}/index.html`);
        // styles.css references the fonts with absolute /fonts/ URLs (correct
        // for the website); on a CDN subpath they must be relative to the CSS
        // file, which is emitted into assets/.
        for (const f of readdirSync(`${out}/assets`)) {
          if (f.endsWith('.css')) {
            const p = `${out}/assets/${f}`;
            // The minifier may emit url(/fonts/...) with or without quotes.
            const css = readFileSync(p, 'utf-8')
              .replaceAll('url(/fonts/', 'url(../fonts/')
              .replaceAll("url('/fonts/", "url('../fonts/")
              .replaceAll('url("/fonts/', 'url("../fonts/');
            writeFileSync(p, css);
          }
        }
      },
    },
  ],
});
