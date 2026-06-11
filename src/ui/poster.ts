// Canvas poster drawing — shared by the in-app share PNG (1080×1350) and the
// static OG image generator (1200×630, scripts/generate-og.html).

export interface PosterData {
  brand: string; // "INVICTO"
  tagline: string;
  record: string;
  tier: 'invicto' | 'campeon' | 'subcampeon' | 'out';
  tierLabel: string;
  lineup: { slot: string; flag: string; name: string; edition: number }[];
  games: { flag: string; win: boolean }[];
  footer: string;
  hard: boolean;
}

const NAVY = '#0a1228';
const NAVY_2 = '#16264f';
const GOLD = '#f5b942';
const GOLD_2 = '#ffd87a';
const DIM = '#9fadd6';
const TEXT = '#eef2ff';

function bg(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, h * 1.2);
  grad.addColorStop(0, NAVY_2);
  grad.addColorStop(0.65, NAVY);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // stadium light beams
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = GOLD;
  for (const x of [w * 0.2, w * 0.8]) {
    ctx.beginPath();
    ctx.moveTo(x, -40);
    ctx.lineTo(x - w * 0.3, h);
    ctx.lineTo(x + w * 0.3, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function tierColor(tier: PosterData['tier']): string {
  return tier === 'invicto' ? GOLD : tier === 'campeon' ? GOLD_2 : DIM;
}

export async function ensurePosterFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load('90px Anton'), document.fonts.load('700 30px Inter')]);
  } catch {
    // system fallbacks are acceptable
  }
}

/** 1080×1350 share poster. */
export function drawSharePoster(canvas: HTMLCanvasElement, data: PosterData): void {
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;
  bg(ctx, 1080, 1350);
  ctx.textAlign = 'center';

  ctx.fillStyle = GOLD;
  ctx.font = '64px Anton, sans-serif';
  ctx.fillText(data.brand + (data.hard ? ' 🔥' : ''), 540, 110);
  ctx.fillStyle = DIM;
  ctx.font = '600 30px Inter, sans-serif';
  ctx.fillText(data.tagline, 540, 158);

  ctx.fillStyle = tierColor(data.tier);
  ctx.font = '74px Anton, sans-serif';
  ctx.fillText(data.tierLabel, 540, 280);

  if (data.tier === 'invicto') {
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 60;
  }
  ctx.fillStyle = data.tier === 'invicto' ? GOLD : TEXT;
  ctx.font = '230px Anton, sans-serif';
  ctx.fillText(data.record, 540, 510);
  ctx.shadowBlur = 0;

  // games strip
  ctx.font = '44px Inter, sans-serif';
  const strip = data.games.map((g) => `${g.flag}${g.win ? '✅' : '❌'}`).join(' ');
  ctx.fillText(strip, 540, 590);

  // lineup
  ctx.textAlign = 'left';
  const top = 680;
  const lineH = 62;
  data.lineup.forEach((row, i) => {
    const y = top + i * lineH;
    ctx.fillStyle = DIM;
    ctx.font = '700 28px Inter, sans-serif';
    ctx.fillText(row.slot, 120, y);
    ctx.font = '36px Inter, sans-serif';
    ctx.fillText(row.flag, 195, y + 2);
    ctx.fillStyle = TEXT;
    ctx.font = '600 36px Inter, sans-serif';
    ctx.fillText(row.name, 260, y);
    ctx.fillStyle = DIM;
    ctx.font = '30px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`'${String(row.edition).slice(2)}`, 960, y);
    ctx.textAlign = 'left';
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = DIM;
  ctx.font = '700 30px Inter, sans-serif';
  ctx.fillText(data.footer, 540, 1295);
}

/** 1200×630 OG card (no lineup — headline treatment). */
export function drawOgPoster(canvas: HTMLCanvasElement, data: Pick<PosterData, 'brand' | 'tagline'> & { subline: string }): void {
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d')!;
  bg(ctx, 1200, 630);
  ctx.textAlign = 'center';

  ctx.fillStyle = GOLD;
  ctx.shadowColor = GOLD;
  ctx.shadowBlur = 70;
  ctx.font = '170px Anton, sans-serif';
  ctx.fillText(data.brand, 600, 280);
  ctx.shadowBlur = 0;

  ctx.fillStyle = TEXT;
  ctx.font = '600 52px Inter, sans-serif';
  ctx.fillText(data.tagline, 600, 380);

  ctx.fillStyle = DIM;
  ctx.font = '40px Inter, sans-serif';
  ctx.fillText(data.subline, 600, 460);

  ctx.font = '54px Inter, sans-serif';
  ctx.fillText('🇻🇪 🇩🇴 🇵🇷 🇯🇵 🇺🇸 🇲🇽 🇨🇺 🇰🇷 🇳🇱 🇹🇼', 600, 555);
}
