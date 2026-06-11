// Tiny i18n: dot-path lookup with {placeholder} interpolation. Spanish is the
// default for any es-* browser; the choice persists once the user toggles.

import es from './es.json';
import en from './en.json';

export type Lang = 'es' | 'en';

const tables: Record<Lang, unknown> = { es, en };

let current: Lang = detectLang();

function detectLang(): Lang {
  const stored = localStorage.getItem('invicto.lang');
  if (stored === 'es' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  localStorage.setItem('invicto.lang', lang);
  document.documentElement.lang = lang;
  applyMeta();
}

export function toggleLang(): Lang {
  setLang(current === 'es' ? 'en' : 'es');
  return current;
}

function lookup(path: string): unknown {
  let node: unknown = tables[current];
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

/** The three how-to-play panels. */
export function howtoPanels(): { icon: string; title: string; body: string }[] {
  return lookup('howto') as { icon: string; title: string; body: string }[];
}

export function applyMeta(): void {
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', t('meta.title'));
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', t('meta.description'));
}
