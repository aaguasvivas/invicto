// Per-country accent colors, picked from each flag but brightened to read on
// navy. Applied to --accent when a roll lands (roll card bar, edition text,
// lineup borders, search focus ring).

export const COUNTRY_ACCENTS: Record<string, string> = {
  AUS: '#ffd24a',
  BRA: '#57d98e',
  CAN: '#ff6b6b',
  CHN: '#ff6b6b',
  COL: '#ffd24a',
  CUB: '#ff6b6b',
  CZE: '#6ea8ff',
  DOM: '#ff5d6e',
  ESP: '#ff9d4d',
  GBR: '#6ea8ff',
  ISR: '#7ec8ff',
  ITA: '#57d98e',
  JPN: '#ff7e8a',
  KOR: '#7ec8ff',
  MEX: '#57d98e',
  NCA: '#6ea8ff',
  NED: '#ff9d4d',
  PAN: '#6ea8ff',
  PUR: '#ff8a5c',
  RSA: '#57d98e',
  TPE: '#5fb0ff',
  USA: '#6ea8ff',
  VEN: '#ffd24a',
};

export function setAccent(countryCode: string | null): void {
  document.documentElement.style.setProperty(
    '--accent',
    countryCode ? (COUNTRY_ACCENTS[countryCode] ?? 'var(--gold)') : 'var(--gold)',
  );
}
