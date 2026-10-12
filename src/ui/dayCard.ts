// Pieces of the day card, which shows today's challenge once it is played (the
// title) and after a daily run (the result): the live countdown, the streak
// chip and lines that set one value in bold.
//
// The countdown recomputes from the clock on every tick (it never counts a
// stored value down), so a tab that slept is right the moment it wakes. Only
// one screen is up at a time, so one countdown runs at a time: a new one stops
// the last, and one whose screen is gone stops itself.

import { formatCountdown, msUntilNextDay, todayKey } from '../game/state';
import { t } from '../i18n';
import { h } from './dom';

let running: ReturnType<typeof setInterval> | undefined;

/** A localized line with its {name} value set off as an element, wherever the language puts it; params fill the rest. */
export function lineWith(key: string, name: string, value: HTMLElement, params: Record<string, string | number> = {}): (string | HTMLElement)[] {
  const [before, after] = t(key, { ...params, [name]: '\u0000' }).split('\u0000');
  return [before, value, after];
}

/** A "Next challenge in hh:mm:ss" line. At midnight it stops and calls onNewDay once. */
export function countdownLine(onNewDay: () => void): HTMLElement {
  clearInterval(running);
  const day = todayKey();
  const time = h('b');
  const el = h('div.countdown', { role: 'timer' }, ...lineWith('title.nextDailyLive', 'time', time));
  const paint = () => {
    time.textContent = formatCountdown(msUntilNextDay(new Date()));
  };
  paint();
  const timer = setInterval(() => {
    if (el.isConnected && todayKey() === day) return paint();
    clearInterval(timer);
    if (el.isConnected) onNewDay();
  }, 1000);
  running = timer;
  return el;
}

/** The daily streak as a gold "🔥 n", named in full for screen readers. pop: it just grew. */
export function streakChip(n: number, pop = false): HTMLElement {
  const label = t('title.streak', { n });
  return h(`span.streak-chip${pop ? '.pop' : ''}`, { role: 'img', 'aria-label': label, title: label }, `🔥 ${n}`);
}
