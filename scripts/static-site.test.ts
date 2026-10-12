// Static site hygiene: the parts of public/ and wrangler.jsonc that no build
// step checks, so a regression here would ship silently.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const repoPath = (path: string) => new URL(`../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repoPath(path), 'utf-8');

/** Parses public/_headers into path pattern -> header lines. */
function headerRules(): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  let current: string[] = [];
  for (const line of read('public/_headers').split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) current.push(line.trim());
    else rules.set(line.trim(), (current = []));
  }
  return rules;
}

describe('_headers', () => {
  test('only the content-hashed /assets/* files are cached as immutable', () => {
    const rules = headerRules();
    expect(rules.has('/assets/*')).toBe(true);
    for (const [path, headers] of rules) {
      expect(headers.some((h) => /^Cache-Control:.*immutable/i.test(h)), path).toBe(path === '/assets/*');
    }
    // Vite writes hashed names into dist/assets/. A file under public/assets/
    // would keep its name and still be pinned in browsers for a year.
    expect(existsSync(repoPath('public/assets'))).toBe(false);
  });

  test('every response carries the baseline security headers', () => {
    expect(headerRules().get('/*')).toEqual(
      expect.arrayContaining([
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: strict-origin-when-cross-origin',
        'Permissions-Policy: camera=(), microphone=(), geolocation=()',
      ]),
    );
  });
});

describe('unknown paths', () => {
  test('wrangler answers them with public/404.html instead of the game', () => {
    expect(read('wrangler.jsonc')).toMatch(/"not_found_handling":\s*"404-page"/);
  });

  test('the 404 page links home in both languages and uses only root-relative URLs', () => {
    const html = read('public/404.html');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/en/"');
    // It is served at any depth (/en/rosters/typo), so a relative URL would break.
    for (const [, url] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
      expect(url).toMatch(/^(\/|https:\/\/|mailto:|data:)/);
    }
  });
});

describe('bilingual static pages', () => {
  test.each(['how-to-play', 'faq', 'about', 'privacy', 'terms', 'contact'])(
    '%s.html wraps its English half in one <section lang="en" id="en">',
    (page) => {
      const html = read(`public/${page}.html`);
      expect(html.match(/<section lang="en" id="en">/g)).toHaveLength(1);
      expect(html).toMatch(/<section lang="en" id="en">[\s\S]*<\/section>\s*<\/main>/);
    },
  );
});

test('sitemap.xml declares the sitemaps.org namespace', () => {
  expect(read('public/sitemap.xml')).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
});
