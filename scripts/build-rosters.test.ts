import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { COUNTRIES } from './lib/countries';
import { countryIntro, loadSiteInput, renderSite, topPlayers, type RosterRecord } from './build-rosters';

const country = (code: string) => COUNTRIES.find((c) => c.code === code)!;
const ALL = [2006, 2009, 2013, 2017, 2023, 2026];
const input = loadSiteInput();
const site = renderSite(input);
const pages = [...site].filter(([file]) => /^(en\/)?rosters\//.test(file));

describe('countryIntro', () => {
  test('a country that played every edition', () => {
    expect(countryIntro('es', country('CAN'), ALL, ALL, 175)).toBe(
      'Canadá ha jugado las seis ediciones que cubre Invicto (2006 a 2026): 175 registros de roster con posición, club de la época y el rating 1-99 del juego (<a href="/about.html">metodología</a>).',
    );
    expect(countryIntro('en', country('CAN'), ALL, ALL, 175)).toBe(
      "Canada has played all six editions Invicto covers (2006 to 2026): 175 roster records with position, club at the time and the game's 1-99 rating (<a href=\"/about.html#en\">methodology</a>).",
    );
  });

  test('a country that played one edition', () => {
    expect(countryIntro('es', country('ESP'), [2013], ALL, 28)).toBe(
      'España ha jugado una de las seis ediciones que cubre Invicto (2013): 28 registros de roster con posición, club de la época y el rating 1-99 del juego (<a href="/about.html">metodología</a>).',
    );
    expect(countryIntro('en', country('ESP'), [2013], ALL, 28)).toBe(
      "Spain has played one of the six editions Invicto covers (2013): 28 roster records with position, club at the time and the game's 1-99 rating (<a href=\"/about.html#en\">methodology</a>).",
    );
  });

  test('other counts are words, and English names take "the" where English does', () => {
    expect(countryIntro('es', country('PAN'), [2006, 2009, 2023, 2026], ALL, 118)).toMatch(
      /^Panamá ha jugado cuatro de las seis ediciones que cubre Invicto \(2006, 2009, 2023, 2026\): 118 registros/,
    );
    expect(countryIntro('en', country('CZE'), [2023, 2026], ALL, 61)).toMatch(
      /^The Czech Republic has played two of the six editions Invicto covers \(2023, 2026\): 61 roster records/,
    );
    expect(countryIntro('en', country('USA'), ALL, ALL, 180)).toMatch(/^The United States has played all six editions/);
  });
});

describe('topPlayers', () => {
  const rec = (personKey: string, name: string, edition: number, rating: number): RosterRecord => ({
    personKey, name, edition, rating, country: 'CAN', positions: ['1B'], club: null,
  });

  test('keeps each person once, at his best edition, the earliest on a tie', () => {
    const top = topPlayers(
      [rec('votto', 'Joey Votto', 2009, 92), rec('votto', 'Joey Votto', 2013, 92), rec('votto', 'Joey Votto', 2017, 80)],
      5,
    );
    expect(top.map((p) => p.edition)).toEqual([2009]);
  });

  test('orders by rating, then by name', () => {
    const top = topPlayers([rec('b', 'Mike Trout', 2023, 92), rec('a', 'Bobby Witt Jr.', 2023, 92), rec('c', 'Aaron Judge', 2026, 99)], 2);
    expect(top.map((p) => p.name)).toEqual(['Aaron Judge', 'Bobby Witt Jr.']);
  });
});

describe('generated pages', () => {
  test('every page has share tags', () => {
    for (const [file, html] of pages) {
      for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'og:site_name']) {
        expect(html, `${file} ${tag}`).toMatch(new RegExp(`<meta property="${tag}" content="[^"]+" />`));
      }
      for (const tag of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) {
        expect(html, `${file} ${tag}`).toMatch(new RegExp(`<meta name="${tag}" content="[^"]+" />`));
      }
    }
  });

  test('English pages open the English half of the bilingual pages', () => {
    const articles = ['articles', 'en/articles'].flatMap((dir) =>
      readdirSync(`public/${dir}`).map((f): [string, string] => [`${dir}/${f}`, readFileSync(`public/${dir}/${f}`, 'utf-8')]),
    );
    for (const [file, html] of [...pages, ...articles]) {
      const english = file.startsWith('en/');
      for (const page of ['how-to-play', 'about', 'faq', 'privacy', 'terms', 'contact']) {
        const links = [...html.matchAll(new RegExp(`href="/${page}\\.html(#en)?"`, 'g'))];
        if (page === 'how-to-play' || page === 'about') expect(links.length, `${file} ${page}`).toBeGreaterThan(0);
        for (const [, anchor] of links) expect(anchor, `${file} ${page}`).toBe(english ? '#en' : undefined);
      }
    }
  });

  test('the index pages head the article list as Artículos and Articles', () => {
    expect(site.get('rosters/index.html')).toContain('<h2>Artículos</h2>');
    expect(site.get('en/rosters/index.html')).toContain('<h2>Articles</h2>');
  });

  test('a one-edition country gets a single year in its title', () => {
    expect(site.get('rosters/spain.html')).toContain('<title>España en el Clásico Mundial: rosters 2013 · Invicto</title>');
    expect(site.get('en/rosters/united-states.html')).toContain(
      '<title>The United States at the World Baseball Classic: rosters 2006-2026 · Invicto</title>',
    );
  });

  test('no generated file has an em dash', () => {
    for (const [file, content] of site) expect(content.includes('\u2014'), file).toBe(false);
  });

  test('a country without a history paragraph fails the build', () => {
    const { CAN: _dropped, ...countries } = input.editorial.countries;
    expect(() => renderSite({ ...input, editorial: { ...input.editorial, countries } })).toThrow(/CAN/);
  });
});

describe('sitemap.xml', () => {
  const xml = site.get('sitemap.xml')!;
  const locs = [...xml.matchAll(/<loc>https:\/\/invictobaseball\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]);

  test('declares the sitemaps.org namespace', () => {
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<url>/g)).toHaveLength(locs.length);
  });

  test('every listed page exists', () => {
    expect(new Set(locs).size).toBe(locs.length);
    for (const loc of locs) {
      const locale = loc.match(/^\/([a-z]{2})\/$/);
      if (loc === '/') expect(existsSync('index.html')).toBe(true);
      else if (locale) expect(existsSync(`src/i18n/${locale[1]}.json`), loc).toBe(true);
      else expect(existsSync(`public${loc}${loc.endsWith('/') ? 'index' : ''}.html`), loc).toBe(true);
    }
  });

  test('lists every generated page and every hand-written one', () => {
    for (const [file] of pages) expect(locs).toContain(`/${file.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1')}`);
    for (const page of ['/how-to-play', '/about', '/faq', '/articles/los-mejores-del-clasico', '/en/articles/how-to-run-the-table']) {
      expect(locs).toContain(page);
    }
    expect(locs).not.toContain('/404');
  });
});

test('the checked-in pages are what the generator makes from the checked-in data (npm run build-rosters)', () => {
  for (const [file, content] of site) expect(readFileSync(`public/${file}`, 'utf-8') === content, file).toBe(true);
  for (const dir of ['rosters', 'en/rosters']) {
    for (const file of readdirSync(`public/${dir}`)) expect(site.has(`${dir}/${file}`), `${dir}/${file}`).toBe(true);
  }
});
