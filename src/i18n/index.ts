// Tiny i18n with a language registry: adding a language is one JSON file plus
// one REGISTRY entry (see README "Adding a language"). Spanish is the default
// for any es-* browser; the choice persists once the user picks. The /en/,
// /ja/ and /ko/ entry pages hint their language for that page view only, and
// in the CrazyGames build the portal's locale for its player replaces the
// browser's guess (adoptHostLocale).
//
// Brand nouns (INVICTO, CAMPEÓN) are deliberately NOT translated: they are the
// game's tier names in every language, like a trophy engraving.

import * as storage from '../game/storage';
import es from './es.json';
import en from './en.json';
import ja from './ja.json';
import ko from './ko.json';

export interface LanguageDef {
  code: string;
  /** Native name, shown in the language switcher. */
  label: string;
  table: unknown;
  /** BCP 47 tag for Intl date formatting. */
  locale: string;
}

export const REGISTRY: LanguageDef[] = [
  { code: 'es', label: 'Español', table: es, locale: 'es' },
  { code: 'en', label: 'English', table: en, locale: 'en' },
  { code: 'ja', label: '日本語', table: ja, locale: 'ja' },
  { code: 'ko', label: '한국어', table: ko, locale: 'ko' },
];

export type Lang = string;

declare global {
  /** The language of a locale entry page, set by its inline script (scripts/lib/localizeHtml.ts). */
  var __INVICTO_LANG: string | undefined;
}

const byCode = (code: string | null | undefined) => REGISTRY.find((l) => l.code === code);
/** Ours for a BCP 47 locale by its language part: "es-419" and "ko_KR" match, "pt-BR" does not. */
const byLocale = (locale: string | undefined) => byCode(locale?.toLowerCase().split(/[-_]/)[0]);
const ENGLISH = byCode('en') ?? REGISTRY[0];
/** The language the player picked in the game (only setLang stores one). */
const storedChoice = () => byCode(storage.get('invicto.lang'));

/** An explicit choice first, then the page's hint, then the browser. */
function detectLang(): LanguageDef {
  const preset = storedChoice() ?? byCode(globalThis.__INVICTO_LANG);
  if (preset) return preset;
  for (const pref of navigator.languages ?? [navigator.language]) {
    const match = byLocale(pref);
    if (match) return match;
  }
  return ENGLISH;
}

let current: LanguageDef;
let cycle: LanguageDef[];

// Switcher cycle for this session: whatever language you start in, the other
// major language (es/en, in REGISTRY order) is always the FIRST tap, then the
// rest. A ja/ko "next" label on first sight reads as "there is no English or
// Spanish here", so it never leads.
function startIn(def: LanguageDef): void {
  current = def;
  cycle = [def, ...REGISTRY.filter((l) => l.code !== def.code)];
}

startIn(detectLang());

/**
 * Start in the language a host platform reports for its player (CrazyGames'
 * systemInfo.locale, e.g. "es-ES"), and in English when it is not one of ours.
 * A language picked in the game still wins. Nothing is stored: like a locale
 * page's hint, it is a default, not the player's choice.
 */
export function adoptHostLocale(locale: string | undefined): void {
  if (!locale || storedChoice()) return;
  startIn(byLocale(locale) ?? ENGLISH);
}

export function getLang(): Lang {
  return current.code;
}

export function getLocale(): string {
  return current.locale;
}

export function setLang(code: Lang): void {
  const def = REGISTRY.find((l) => l.code === code);
  if (!def) return;
  current = def;
  storage.set('invicto.lang', def.code);
  document.documentElement.lang = def.code;
  applyMeta();
}

/** Advance to the next language in this session's cycle (works for any count). */
export function cycleLang(): Lang {
  const idx = cycle.findIndex((l) => l.code === current.code);
  setLang(cycle[(idx + 1) % cycle.length].code);
  return current.code;
}

/** Label for the language switcher: the language you would switch TO. */
export function nextLangLabel(): string {
  const idx = cycle.findIndex((l) => l.code === current.code);
  return cycle[(idx + 1) % cycle.length].label;
}

function lookup(path: string): unknown {
  let node: unknown = current.table;
  for (const part of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

/** Translate a dot-path key. Missing keys return the key itself (visible bug > silent blank). */
export function t(path: string, params?: Record<string, string | number>): string {
  const value = lookup(path);
  return typeof value === 'string' ? interpolate(value, params) : path;
}

/** A flavor line for an engine flavorKey; variant wraps around the table length. */
export function flavor(key: string, variant: number, params: Record<string, string | number>): string {
  const list = lookup(`flavor.${key}`);
  if (!Array.isArray(list) || list.length === 0) return key;
  return interpolate(String(list[variant % list.length]), params);
}

/** The How to play panels, in order. */
export function howtoPanels(): { icon: string; title: string; body: string }[] {
  return lookup('howto.panels') as { icon: string; title: string; body: string }[];
}

/** Localized country display name; falls back to the English name from the data. */
export function countryName(c: { code: string; nameEn: string }): string {
  const localized = lookup(`countries.${c.code}`);
  return typeof localized === 'string' ? localized : c.nameEn;
}

export function applyMeta(): void {
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', t('meta.title'));
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', t('meta.description'));
}
