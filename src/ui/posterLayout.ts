// Pure layout math for the share-poster games strip. Kept separate from the
// canvas drawing so the "never overflow" invariant is unit-testable without a
// real CanvasRenderingContext (jsdom has none).
//
// Why not just measureText the strip and center it? Because measureText lies
// about color-emoji width and the lie is platform-dependent: flag glyphs render
// wider than reported, so textAlign='center' anchored on the measured width
// spills off the right edge on the device that generates the PNG. Instead we
// position each game at a fixed cell center we compute ourselves.

export interface StripLayoutOpts {
  totalWidth?: number;
  margin?: number;
  /** widest a single flag+check cell may get (keeps small strips from sprawling) */
  maxCellWidth?: number;
  /** base emoji font size; the result never exceeds this */
  maxFontSize?: number;
}

export interface StripLayout {
  fontSize: number;
  cellWidth: number;
  /** x of each cell's center, left to right, centered on the canvas */
  centers: number[];
}

export function gamesStripLayout(count: number, opts: StripLayoutOpts = {}): StripLayout {
  const totalWidth = opts.totalWidth ?? 1080;
  const margin = opts.margin ?? 90;
  const maxCellWidth = opts.maxCellWidth ?? 140;
  const maxFontSize = opts.maxFontSize ?? 44;

  if (count <= 0) return { fontSize: maxFontSize, cellWidth: 0, centers: [] };

  const usable = totalWidth - 2 * margin;
  const cellWidth = Math.min(maxCellWidth, usable / count);
  // A flag+check pair is ~2 glyphs; ~0.34*cell keeps even wide-rendering emoji
  // (up to ~1.4em each) comfortably inside the cell with no neighbour overlap.
  const fontSize = Math.min(maxFontSize, Math.round(cellWidth * 0.34));

  const groupWidth = count * cellWidth;
  const start = totalWidth / 2 - groupWidth / 2 + cellWidth / 2;
  const centers = Array.from({ length: count }, (_, i) => start + i * cellWidth);

  return { fontSize, cellWidth, centers };
}
