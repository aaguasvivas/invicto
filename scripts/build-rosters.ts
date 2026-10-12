// Roster reference pages, generated from public/data/players.json and editions.json:
//   public/rosters/ (Spanish) and public/en/rosters/ (English): an index, one page per
//   edition and one per country;
//   the top-30 table of the two "best players" articles;
//   public/sitemap.xml.
// `npm run build-rosters` writes into public/. `npm run build-rosters -- --out <dir>` writes
// the same tree into <dir>, so a check can diff it against the checked-in pages.
// The deploy build does not run this script.
//
// The pages are output. Change their copy here and the history paragraphs in
// data/curation/roster-editorial.json, never the HTML.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { EnginePlayer } from '../src/engine/types.js';
import { COUNTRIES, type Country } from './lib/countries.js';

export type Lang = 'es' | 'en';
export type RosterRecord = Pick<EnginePlayer, 'personKey' | 'name' | 'edition' | 'country' | 'positions' | 'rating' | 'club'>;
export interface EditionTeams {
  year: number;
  teams: { code: string; pool: string }[];
}
/** Hand-written history paragraphs: per country code and per edition year, in both languages. */
export interface Editorial {
  countries: Record<string, Record<Lang, string>>;
  editions: Record<string, Record<Lang, string>>;
}
export interface SiteInput {
  players: RosterRecord[];
  editions: EditionTeams[];
  editorial: Editorial;
  /** Current HTML of the two "best players" articles, by path under public/. */
  articles: Record<string, string>;
  /** Hand-written pages under public/ that the sitemap lists, e.g. 'about.html'. */
  staticPages: string[];
}

const ORIGIN = 'https://invictobaseball.com';
const LANGS: Lang[] = ['es', 'en'];
/** Locale entry pages that scripts/postbuild-locales.ts builds from index.html. */
const LOCALE_ROOTS = ['en', 'ja', 'ko'];
const BEST_ARTICLES: Record<Lang, string> = {
  es: 'articles/los-mejores-del-clasico.html',
  en: 'en/articles/best-classic-players-by-the-data.html',
};
const TOP_PLAYERS = 30;

const T = {
  es: {
    ogLocale: 'es_419',
    // public/og*.jpg, the same share images as the game's entry pages.
    image: `${ORIGIN}/og.jpg`,
    imageAlt: 'Logo de INVICTO con la pregunta “¿Puedes quedar invicto?” y las banderas de diez selecciones del Clásico Mundial de Béisbol',
    root: '/',
    rosters: '/rosters/',
    play: 'Jugar',
    howTo: 'Cómo se juega',
    about: 'Acerca de',
    privacy: 'Privacidad',
    terms: 'Términos',
    contact: 'Contacto',
    disclaimer:
      'Invicto no está afiliado, avalado ni patrocinado por el World Baseball Classic, WBCI, MLB, NPB ni por ningún equipo o asociación de jugadores. Los nombres de peloteros y sus estadísticas históricas se usan como referencia factual.',
    sources: 'Fuentes: Wikipedia (rosters), SABR Lahman Baseball Database (estadísticas MLB).',
    ratingMethod: 'Metodología del rating',
    methodology: 'metodología',
    otherLang: 'Read this page in English',
    player: 'Pelotero',
    country: 'País',
    allRosters: 'Todos los rosters',
  },
  en: {
    ogLocale: 'en_US',
    image: `${ORIGIN}/og-en.jpg`,
    imageAlt: 'The INVICTO logo with the question “Can you run the table?” and the flags of ten World Baseball Classic teams',
    root: '/en/',
    rosters: '/en/rosters/',
    play: 'Play',
    howTo: 'How to play',
    about: 'About',
    privacy: 'Privacy',
    terms: 'Terms',
    contact: 'Contact',
    disclaimer:
      "Invicto is not affiliated with, endorsed by, or sponsored by the World Baseball Classic, WBCI, MLB, NPB, or any team or players' association. Player names and historical statistics are used as factual references.",
    sources: 'Sources: Wikipedia (rosters), SABR Lahman Baseball Database (MLB stats).',
    ratingMethod: 'Rating methodology',
    methodology: 'methodology',
    otherLang: 'Leer esta página en español',
    player: 'Player',
    country: 'Country',
    allRosters: 'All rosters',
  },
} as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

const slugOf = (c: Country) => c.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const countryOf = (code: string) => {
  const c = COUNTRIES.find((x) => x.code === code);
  if (!c) throw new Error(`Unknown country code ${code}`);
  return c;
};
const nameOf = (lang: Lang, c: Country) => (lang === 'es' ? c.nameEs : c.nameEn);
/** English names that take "the" in a sentence. */
const ENGLISH_THE = new Set(['CZE', 'DOM', 'NED', 'USA']);
/** A country as the subject of a sentence: "The Netherlands", "Países Bajos". */
const subjectOf = (lang: Lang, c: Country) => (lang === 'en' && ENGLISH_THE.has(c.code) ? `The ${c.nameEn}` : nameOf(lang, c));
const possessive = (name: string) => `${name}${name.endsWith('s') ? "'" : "'s"}`;
/** Site path of a page in the other language's tree. */
const otherTree = (lang: Lang, path: string) => (lang === 'es' ? `/en${path}` : path.replace(/^\/en\//, '/'));
/** The six bilingual pages (how-to-play, about, faq...) keep their English half under #en. */
const staticHref = (lang: Lang, page: string) => `/${page}.html${lang === 'en' ? '#en' : ''}`;

const NUMBER_WORDS: Record<Lang, string[]> = {
  es: ['una', 'dos', 'tres', 'cuatro', 'cinco', 'seis'],
  en: ['one', 'two', 'three', 'four', 'five', 'six'],
};
/** An edition count in words ("una", "six"), feminine in Spanish to agree with "ediciones". */
function editionsInWords(lang: Lang, n: number): string {
  const word = NUMBER_WORDS[lang][n - 1];
  if (!word) throw new Error(`No word for ${n} editions: extend NUMBER_WORDS`);
  return word;
}

/** Rating first, then name: the order of every table and every top list. */
const byRatingThenName = (a: RosterRecord, b: RosterRecord) => b.rating - a.rating || a.name.localeCompare(b.name, 'en');

interface Page {
  lang: Lang;
  /** Site path, e.g. /rosters/canada or /en/rosters/ */
  path: string;
  /** Without the " · Invicto" suffix, which only the <title> carries. */
  title: string;
  description: string;
  main: string[];
}

function renderPage({ lang, path, title, description, main }: Page): string {
  const t = T[lang];
  const esPath = lang === 'es' ? path : otherTree(lang, path);
  const enPath = lang === 'en' ? path : otherTree(lang, path);
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0a1228" />
    <title>${esc(title)} · Invicto</title>
    <meta name="description" content="${attr(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Invicto" />
    <meta property="og:locale" content="${t.ogLocale}" />
    <meta property="og:locale:alternate" content="${T[lang === 'es' ? 'en' : 'es'].ogLocale}" />
    <meta property="og:title" content="${attr(title)}" />
    <meta property="og:description" content="${attr(description)}" />
    <meta property="og:url" content="${ORIGIN}${path}" />
    <meta property="og:image" content="${t.image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${attr(t.imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${attr(title)}" />
    <meta name="twitter:description" content="${attr(description)}" />
    <meta name="twitter:image" content="${t.image}" />
    <meta name="twitter:image:alt" content="${attr(t.imageAlt)}" />
    <link rel="canonical" href="${ORIGIN}${path}" />
    <link rel="alternate" hreflang="es" href="${ORIGIN}${esPath}" />
    <link rel="alternate" hreflang="en" href="${ORIGIN}${enPath}" />
    <link rel="alternate" hreflang="x-default" href="${ORIGIN}${esPath}" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚾</text></svg>" />
    <link rel="stylesheet" href="/pages.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="${t.root}">INVICTO</a>
      <nav>
        <a class="play" href="${t.root}">${t.play}</a>
        <a href="${t.rosters}">Rosters</a>
        <a href="${staticHref(lang, 'how-to-play')}">${t.howTo}</a>
        <a href="${staticHref(lang, 'about')}">${t.about}</a>
      </nav>
    </header>
    <main class="page">
${main.map((line) => `      ${line}`).join('\n')}
      <p><a href="${otherTree(lang, path)}">${t.otherLang}</a></p>
    </main>
    <footer class="site-footer">
      <p class="disclaimer">${esc(t.disclaimer)}</p>
      <nav>
        <a href="${t.root}">${t.play}</a>
        <a href="${t.rosters}">Rosters</a>
        <a href="${staticHref(lang, 'about')}">${t.about}</a>
        <a href="${staticHref(lang, 'faq')}">FAQ</a>
        <a href="${staticHref(lang, 'privacy')}">${t.privacy}</a>
        <a href="${staticHref(lang, 'terms')}">${t.terms}</a>
        <a href="${staticHref(lang, 'contact')}">${t.contact}</a>
      </nav>
      <p>${t.sources} <a href="${staticHref(lang, 'about')}">${t.ratingMethod}</a>.</p>
      <p>© 2026 Invicto · invictobaseball.com</p>
    </footer>
  </body>
</html>
`;
}

function rosterTable(lang: Lang, rows: RosterRecord[]): string[] {
  return [
    '<div class="table-wrap"><table>',
    `  <thead><tr><th>Pos</th><th>${T[lang].player}</th><th>Club</th><th>Rating</th></tr></thead>`,
    '  <tbody>',
    ...rows.map(
      (p) => `  <tr><td>${p.positions.join('·')}</td><td>${esc(p.name)}</td><td>${esc(p.club ?? '')}</td><td>${p.rating}</td></tr>`,
    ),
    '  </tbody>',
    '</table></div>',
  ];
}

const methodologyLink = (lang: Lang) => `(<a href="${staticHref(lang, 'about')}">${T[lang].methodology}</a>)`;
const editionHref = (lang: Lang, year: number) => `${T[lang].rosters}wbc-${year}`;
const editionLinks = (lang: Lang, years: number[]) => years.map((y) => `<a href="${editionHref(lang, y)}">${y}</a>`).join(' · ');

/** The sentence that introduces a country's records on its page. */
export function countryIntro(lang: Lang, c: Country, years: number[], allYears: number[], records: number): string {
  const subject = subjectOf(lang, c);
  const total = editionsInWords(lang, allYears.length);
  const [first, last] = [allYears[0], allYears[allYears.length - 1]];
  const all = years.length === allYears.length;
  const k = editionsInWords(lang, years.length);
  return lang === 'es'
    ? `${subject} ha jugado ${all ? `las ${total} ediciones que cubre Invicto (${first} a ${last})` : `${k} de las ${total} ediciones que cubre Invicto (${years.join(', ')})`}: ${records} registros de roster con posición, club de la época y el rating 1-99 del juego ${methodologyLink(lang)}.`
    : `${subject} has played ${all ? `all ${total} editions Invicto covers (${first} to ${last})` : `${k} of the ${total} editions Invicto covers (${years.join(', ')})`}: ${records} roster records with position, club at the time and the game's 1-99 rating ${methodologyLink(lang)}.`;
}

function countryPage(lang: Lang, c: Country, records: RosterRecord[], editorial: Editorial, allYears: number[]): Page {
  const name = subjectOf(lang, c);
  const years = [...new Set(records.map((p) => p.edition))].sort((a, b) => a - b);
  const lead = editorial.countries[c.code]?.[lang];
  if (!lead) throw new Error(`roster-editorial.json: no ${lang} history paragraph for ${c.code}`);
  const peakText = topPlayers(records, 3)
    .map((p) => `${esc(p.name)} (${p.edition}, rating ${p.rating})`)
    .join('; ');

  const main = [
    `<h1>${c.flag} ${lang === 'es' ? `${name} en el Clásico Mundial de Béisbol` : `${name} at the World Baseball Classic`}</h1>`,
    `<p class="lead">${lead}</p>`,
    `<p>${countryIntro(lang, c, years, allYears, records.length)} ${lang === 'es' ? 'Sus picos históricos en los datos' : 'Their historical peaks in the data'}: ${peakText}.</p>`,
    `<p><a class="cta" href="${T[lang].root}">${lang === 'es' ? 'Arma tu equipo con estos peloteros' : 'Draft your team with these players'}</a></p>`,
  ];
  for (const year of years) {
    const rows = records.filter((p) => p.edition === year).sort(byRatingThenName);
    main.push(
      `<h2 id="wbc-${year}">WBC ${year} (${rows.length} ${lang === 'es' ? 'peloteros' : 'players'})</h2>`,
      lang === 'es'
        ? `<p>${name} en la edición ${year}. La carta más alta del año: ${esc(rows[0].name)} (${rows[0].rating}).</p>`
        : `<p>${name} in the ${year} edition. The highest card of the year: ${esc(rows[0].name)} (${rows[0].rating}).</p>`,
      ...rosterTable(lang, rows),
    );
  }
  main.push(
    `<p><a href="${T[lang].rosters}">${T[lang].allRosters}</a> · ${lang === 'es' ? 'Ediciones' : 'Editions'}: ${editionLinks(lang, allYears)}</p>`,
  );

  const span = years.length === 1 ? `${years[0]}` : `${years[0]}-${years[years.length - 1]}`;
  return {
    lang,
    path: `${T[lang].rosters}${slugOf(c)}`,
    title: lang === 'es' ? `${name} en el Clásico Mundial: rosters ${span}` : `${name} at the World Baseball Classic: rosters ${span}`,
    description:
      lang === 'es'
        ? `La historia de ${name} en el World Baseball Classic y sus rosters completos (${years.join(', ')}) con posiciones, clubes y ratings.`
        : `${possessive(name)} World Baseball Classic history and complete rosters (${years.join(', ')}) with positions, clubs and ratings.`,
    main,
  };
}

function editionPage(lang: Lang, edition: EditionTeams, players: RosterRecord[], editorial: Editorial, allYears: number[]): Page {
  const { year } = edition;
  const lead = editorial.editions[year]?.[lang];
  if (!lead) throw new Error(`roster-editorial.json: no ${lang} history paragraph for ${year}`);
  const teams = edition.teams.map(({ code, pool }) => ({
    pool,
    country: countryOf(code),
    rows: players.filter((p) => p.edition === year && p.country === code).sort(byRatingThenName),
  }));
  for (const team of teams) if (team.rows.length === 0) throw new Error(`${year} ${team.country.code}: no players`);
  const total = teams.reduce((n, team) => n + team.rows.length, 0);
  const top5 = topPlayers(
    teams.flatMap((team) => team.rows),
    5,
  )
    .map((p) => `${esc(p.name)} (${countryOf(p.country).flag} ${p.rating})`)
    .join(', ');

  const main = [
    `<h1>${lang === 'es' ? `Rosters del Clásico Mundial de Béisbol ${year}` : `${year} World Baseball Classic rosters`}</h1>`,
    `<p class="lead">${lead}</p>`,
    lang === 'es'
      ? `<p>Abajo están los ${teams.length} equipos y ${total} peloteros de la edición ${year}, agrupados por su pool original, con el club de la época y el rating 1-99 que usa Invicto, calculado con estadísticas reales ${methodologyLink(lang)}. Los cinco mejor rateados del año: ${top5}.</p>`
      : `<p>Below are all ${teams.length} teams and ${total} players of the ${year} edition, grouped by their original pool, with each player's club at the time and the 1-99 rating used in Invicto, calculated from real statistics ${methodologyLink(lang)}. The five highest-rated players of the year: ${top5}.</p>`,
    `<p><a class="cta" href="${T[lang].root}">${lang === 'es' ? 'Arma tu equipo con estos rosters' : 'Draft your team from these rosters'}</a></p>`,
  ];
  let pool = '';
  for (const team of teams) {
    if (team.pool !== pool) main.push(`<h2>Pool ${(pool = team.pool)}</h2>`);
    main.push(
      `<h3 id="${slugOf(team.country)}">${team.country.flag} ${nameOf(lang, team.country)} (${team.rows.length})</h3>`,
      ...rosterTable(lang, team.rows),
    );
  }
  const others = editionLinks(lang, allYears.filter((y) => y !== year));
  main.push(
    lang === 'es'
      ? `<p>Otras ediciones: ${others} · <a href="${T.es.rosters}">${T.es.allRosters}</a> · <a href="/${BEST_ARTICLES.es}">Los mejores del Clásico según los datos</a></p>`
      : `<p>Other editions: ${others} · <a href="${T.en.rosters}">${T.en.allRosters}</a> · <a href="/${BEST_ARTICLES.en}">The best Classic players, according to the data</a></p>`,
  );

  return {
    lang,
    path: editionHref(lang, year),
    title: lang === 'es' ? `Rosters del Clásico Mundial ${year} con ratings` : `${year} World Baseball Classic rosters with ratings`,
    description:
      lang === 'es'
        ? `Todos los rosters del World Baseball Classic ${year}: ${teams.length} equipos y ${total} peloteros con club y rating, más la historia de la edición.`
        : `Every ${year} World Baseball Classic roster: ${teams.length} teams and ${total} players with clubs and ratings, plus the story of the edition.`,
    main,
  };
}

const ARTICLE_LINKS: Record<Lang, [string, string][]> = {
  es: [
    ['/articles/como-quedar-invicto.html', 'Cómo quedar INVICTO: la guía de estrategia oficial'],
    ['/articles/dominicana-2013.html', 'La primera temporada perfecta: Dominicana 2013'],
    [`/${BEST_ARTICLES.es}`, 'Los mejores del Clásico según los datos'],
  ],
  en: [
    ['/en/articles/how-to-run-the-table.html', 'How to run the table: the official strategy guide'],
    ['/en/articles/dominican-republic-2013.html', 'The first perfect run: Dominican Republic 2013'],
    [`/${BEST_ARTICLES.en}`, 'The best Classic players, according to the data'],
  ],
};

function indexPage(lang: Lang, editions: EditionTeams[], players: RosterRecord[], countries: Country[]): Page {
  const years = editions.map((e) => e.year);
  const span = `${years[0]}-${years[years.length - 1]}`;
  const sorted = [...countries].sort((a, b) => nameOf(lang, a).localeCompare(nameOf(lang, b), lang));
  const editionItems = editions.map(({ year, teams }) => {
    const n = players.filter((p) => p.edition === year).length;
    return lang === 'es'
      ? `  <li><a href="${editionHref(lang, year)}">Clásico Mundial ${year}</a> (${teams.length} equipos, ${n} peloteros)</li>`
      : `  <li><a href="${editionHref(lang, year)}">${year} World Baseball Classic</a> (${teams.length} teams, ${n} players)</li>`;
  });
  const count = editionsInWords(lang, years.length);
  const main = [
    `<h1>${lang === 'es' ? `Rosters del Clásico Mundial de Béisbol (${span})` : `World Baseball Classic rosters (${span})`}</h1>`,
    lang === 'es'
      ? `<p class="lead">La referencia completa de Invicto: los rosters reales de las ${count} ediciones del Clásico Mundial, con posiciones, clubes de la época y el rating 1-99 que usa el juego, más la historia de cada país y cada edición. Sin jugadores inventados: datos de Wikipedia y de la SABR Lahman Baseball Database ${methodologyLink(lang)}.</p>`
      : `<p class="lead">Invicto’s complete reference: the real rosters of all ${count} World Baseball Classic editions, with positions, clubs of the era and the 1-99 rating the game uses, plus the history behind every country and edition. No invented players: data from Wikipedia and the SABR Lahman Baseball Database ${methodologyLink(lang)}.</p>`,
    `<p><a class="cta" href="${T[lang].root}">${lang === 'es' ? 'Jugar Invicto' : 'Play Invicto'}</a></p>`,
    `<h2>${lang === 'es' ? 'Artículos' : 'Articles'}</h2>`,
    '<ul>',
    ...ARTICLE_LINKS[lang].map(([href, text]) => `  <li><a href="${href}">${text}</a></li>`),
    '</ul>',
    `<h2>${lang === 'es' ? 'Por edición' : 'By edition'}</h2>`,
    '<ul>',
    ...editionItems,
    '</ul>',
    `<h2>${lang === 'es' ? 'Por país' : 'By country'}</h2>`,
    '<ul>',
    ...sorted.map((c) => `  <li><a href="${T[lang].rosters}${slugOf(c)}">${c.flag} ${nameOf(lang, c)}</a></li>`),
    '</ul>',
  ];
  return {
    lang,
    path: T[lang].rosters,
    title: lang === 'es' ? `Rosters del Clásico Mundial de Béisbol ${span} con ratings` : `World Baseball Classic rosters ${span} with ratings`,
    description:
      lang === 'es'
        ? `Todos los rosters reales del World Baseball Classic (${span}) por edición y por país, con posiciones, clubes, ratings y la historia de cada equipo.`
        : `Every real World Baseball Classic roster (${span}) by edition and by country, with positions, clubs, ratings and the history behind each team.`,
    main,
  };
}

/** The best record of each person, best first; ties by name, and a person's earliest edition wins a tie. */
export function topPlayers(players: RosterRecord[], n: number): RosterRecord[] {
  const best = new Map<string, RosterRecord>();
  for (const p of players) {
    const current = best.get(p.personKey);
    if (!current || p.rating > current.rating || (p.rating === current.rating && p.edition < current.edition)) best.set(p.personKey, p);
  }
  return [...best.values()].sort(byRatingThenName).slice(0, n);
}

/** Replaces the rows of the one table in a "best players" article. */
function withTopTable(lang: Lang, html: string, players: RosterRecord[]): string {
  const rows = topPlayers(players, TOP_PLAYERS).map((p, i) => {
    const c = countryOf(p.country);
    return `        <tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${c.flag} ${nameOf(lang, c)}</td><td>${p.edition}</td><td>${p.positions.join('·')}</td><td>${p.rating}</td></tr>`;
  });
  const parts = html.split(/<tbody>\n[\s\S]*?\n(?=\s*<\/tbody>)/);
  if (parts.length !== 2) throw new Error(`${BEST_ARTICLES[lang]}: expected exactly one <tbody>`);
  return `${parts[0]}<tbody>\n${rows.join('\n')}\n${parts[1]}`;
}

/** Site path of a file under public/: about.html → /about, rosters/index.html → /rosters/ */
const sitePath = (file: string) => `/${file.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1')}`;

function sitemap(files: string[]): string {
  const paths = ['/', ...LOCALE_ROOTS.map((code) => `/${code}/`), ...files.map(sitePath)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join('\n')}
</urlset>
`;
}

/** Every generated file, keyed by its path under public/. */
export function renderSite({ players, editions, editorial, articles, staticPages }: SiteInput): Map<string, string> {
  const years = editions.map((e) => e.year);
  const codes = new Set(players.map((p) => p.country));
  const countries = COUNTRIES.filter((c) => codes.has(c.code)).sort((a, b) => slugOf(a).localeCompare(slugOf(b), 'en'));
  for (const code of Object.keys(editorial.countries)) if (!codes.has(code)) throw new Error(`roster-editorial.json: ${code} has no players`);
  for (const year of Object.keys(editorial.editions)) if (!years.includes(Number(year))) throw new Error(`roster-editorial.json: no edition ${year}`);

  const out = new Map<string, string>();
  const rosterFiles: string[] = [];
  for (const lang of LANGS) {
    const pages = [
      indexPage(lang, editions, players, countries),
      ...editions.map((e) => editionPage(lang, e, players, editorial, years)),
      ...countries.map((c) => countryPage(lang, c, players.filter((p) => p.country === c.code), editorial, years)),
    ];
    for (const page of pages) {
      const file = `${page.path.slice(1)}${page.path.endsWith('/') ? 'index' : ''}.html`;
      out.set(file, renderPage(page));
      rosterFiles.push(file);
    }
    const article = BEST_ARTICLES[lang];
    out.set(article, withTopTable(lang, articles[article], players));
  }
  out.set('sitemap.xml', sitemap([...staticPages, ...rosterFiles]));
  return out;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));
const htmlFiles = (dir: string) =>
  readdirSync(join('public', dir))
    .filter((f) => f.endsWith('.html') && f !== '404.html')
    .sort()
    .map((f) => (dir ? `${dir}/${f}` : f));

/** Reads the inputs from the repo (run from its root). */
export function loadSiteInput(): SiteInput {
  return {
    players: readJson('public/data/players.json').players,
    editions: readJson('public/data/editions.json').editions,
    editorial: readJson('data/curation/roster-editorial.json'),
    articles: Object.fromEntries(Object.values(BEST_ARTICLES).map((f) => [f, readFileSync(join('public', f), 'utf-8')])),
    staticPages: [...htmlFiles(''), ...htmlFiles('articles'), ...htmlFiles('en/articles')],
  };
}

function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'public' } } });
  const outDir = values.out ?? 'public';
  const files = renderSite(loadSiteInput());
  for (const [file, content] of files) {
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    writeFileSync(join(outDir, file), content);
  }
  console.log(`build-rosters: ${files.size} files written to ${outDir}/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
