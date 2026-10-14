// The emoji card and the two ways to share a run. A challenge goes as text
// alone, with its link: when files ride along, iOS drops the text, and the
// link with it (WebKit bug 251500). Then the clipboard, then a dialog with the
// text selected, which works even in an iframe that may neither share nor
// copy. The poster goes as a PNG with the card as its caption, then to the
// clipboard.

import type { Grade } from '../game/scout';
import { getLang, getLocale, t } from '../i18n';
import { IS_PORTAL, portalCanInvite, portalInviteLink } from '../portal';
import { openDialog } from './dialog';
import { h } from './dom';
import { drawSharePoster, ensurePosterFonts, type PosterData } from './poster';

/**
 * The site in the player's language (Spanish lives at the root), the base of
 * a challenge link and the start of the poster footer. None in a portal
 * build: game portals do not allow a game to send players to another site, so
 * the domain is compiled out of that bundle.
 */
export function siteUrl(): string | null {
  if (IS_PORTAL) return null;
  const lang = getLang();
  return lang === 'es' ? 'invictobaseball.com/' : `invictobaseball.com/${lang}/`;
}

/** A challenge link on the site, in the player's language. None in a portal build (see siteUrl). */
export function challengeUrl(code: string): string | null {
  const site = siteUrl();
  return site && `https://${site}#r=${code}`;
}

/** Whether this build can hand out a challenge link: the site always, a portal only through its invite links. */
export function canChallenge(): boolean {
  return !IS_PORTAL || portalCanInvite();
}

/** The link that answers a challenge: the site's, or a portal's invite link to the game's page there. */
export async function challengeLink(code: string): Promise<string | null> {
  return IS_PORTAL ? portalInviteLink(code) : challengeUrl(code);
}

/**
 * The poster footer: the site (shown without the trailing slash the share
 * link keeps), the date of the day the run was dealt, and the challenge
 * number, marked when the run was practice. The date is the dealt day at
 * noon, the convention of dailyNumber, so a run finished after midnight keeps
 * its own day.
 */
export function posterFooter(day: string, dailyNum: number | null, practice: boolean): string {
  const date = new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${day}T12:00:00`));
  const challenge = dailyNum ? `#${dailyNum}${practice ? ` ${t('share.practice')}` : ''}` : null;
  return [siteUrl()?.replace(/\/$/, ''), date, challenge].filter(Boolean).join('  ·  ');
}

/** The poster footer's draft tag: the Team OVR to the tenth, then the draft grade once the scout has run. */
export function posterDraft(ovr: number, grade?: Grade): string {
  return [t('share.posterOvr', { n: ovr.toFixed(1) }), grade].filter(Boolean).join('  ·  ');
}

export interface ShareContext {
  /** The challenge number of the day the run was dealt; null outside the daily. */
  dailyNum: number | null;
  /** A replay of a daily already scored: marked, and never shows a streak. */
  practice: boolean;
  hard: boolean;
  /** The daily streak this run kept going; shown from 2. */
  streak: number;
  tierLine: string; // localized: "7-0 ⭐ INVICTO" or "Eliminado en semis 5-1"
  gameFlags: { flag: string; win: boolean }[];
  /** The draft grade and your Team OVR (game/scout.ts), once the scout has run. */
  draft?: { grade: Grade; ovr: number } | null;
}

/** link: the challenge link; the card then ends with the dare and the link. Without one it names no site at all. */
export function emojiCard(ctx: ShareContext, extraLine?: string | null, link?: string | null): string {
  const header = [
    t('share.title'),
    ctx.dailyNum ? `#${ctx.dailyNum}` : null,
    ctx.practice ? t('share.practice') : null,
    !ctx.practice && ctx.streak >= 2 ? `🔥${ctx.streak}` : null,
    // A bare 🔥 tells a group chat nothing; the mode's name does.
    ctx.hard ? `· ${t('title.hard')}` : null,
    '⚾',
  ]
    .filter(Boolean)
    .join(' ');
  const pool = ctx.gameFlags.slice(0, 4).map((g) => `${g.flag}${g.win ? '✅' : '❌'}`).join(' ');
  const ko = ctx.gameFlags.slice(4).map((g) => `${g.flag}${g.win ? '✅' : '❌'}`).join(' ');
  const games = ko ? `${pool} | ${ko}` : pool;
  const lines = [header, games, ctx.tierLine];
  if (ctx.draft) lines.push(t('share.draftLine', { g: ctx.draft.grade, n: ctx.draft.ovr.toFixed(1) }));
  if (extraLine) lines.push(extraLine);
  if (link) lines.push(t('challenge.shareLine'), link);
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/**
 * Share a challenge as text alone. 'shared' also covers a sheet the player
 * closed; 'copied' means it is on the clipboard; 'shown' means it waits in a
 * dialog, selected, to be copied by hand.
 */
export async function shareText(text: string): Promise<'shared' | 'copied' | 'shown'> {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'shared';
      // not allowed here (an iframe's permissions policy): fall through to the clipboard
    }
  }
  if (await copyText(text)) return 'copied';
  showTextToCopy(text);
  return 'shown';
}

function showTextToCopy(text: string): void {
  const heading = h('h2.dialog-title', {}, t('challenge.button'));
  const area = h('textarea.share-text', { readOnly: true, rows: 7, value: text, 'aria-label': t('challenge.copyHint') }) as HTMLTextAreaElement;
  openDialog({ heading, content: [heading, h('p.dialog-text', {}, t('challenge.copyHint')), area], focus: area });
  area.select();
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Share poster PNG via Web Share API; falls back to clipboard image, then text. */
export async function sharePoster(poster: PosterData, card: string): Promise<'shared' | 'copied-image' | 'copied-text' | 'failed'> {
  await ensurePosterFonts();
  const canvas = document.createElement('canvas');
  drawSharePoster(canvas, poster);
  const blob = await canvasBlob(canvas);

  if (blob && navigator.share && navigator.canShare?.({ files: [new File([blob], 'invicto.png', { type: 'image/png' })] })) {
    try {
      await navigator.share({
        files: [new File([blob], 'invicto.png', { type: 'image/png' })],
        text: card,
      });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'shared'; // user closed the sheet
    }
  }
  if (blob && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied-image';
    } catch {
      // fall through to text
    }
  }
  return (await copyText(card)) ? 'copied-text' : 'failed';
}
