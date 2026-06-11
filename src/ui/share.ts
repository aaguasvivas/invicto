// Emoji card + Web Share API with PNG poster (clipboard fallbacks).

import { t } from '../i18n';
import type { RunResult } from '../engine/types';
import { drawSharePoster, ensurePosterFonts, type PosterData } from './poster';

export interface ShareContext {
  run: RunResult;
  dailyNum: number | null;
  hard: boolean;
  tierLine: string; // localized: "7-0 ⭐ INVICTO" or "Eliminado en semis 5-1"
  gameFlags: { flag: string; win: boolean }[];
}

export function emojiCard(ctx: ShareContext): string {
  const header = `${t('share.title')}${ctx.dailyNum ? ` #${ctx.dailyNum}` : ''}${ctx.hard ? ' 🔥' : ''} ⚾`;
  const pool = ctx.gameFlags.slice(0, 4).map((g) => `${g.flag}${g.win ? '✅' : '❌'}`).join(' ');
  const ko = ctx.gameFlags.slice(4).map((g) => `${g.flag}${g.win ? '✅' : '❌'}`).join(' ');
  const games = ko ? `${pool} | ${ko}` : pool;
  return `${header}\n${games}\n${ctx.tierLine}\n${t('share.url')}`;
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
