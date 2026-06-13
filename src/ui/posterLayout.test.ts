// The share-poster games strip must never run off the canvas, regardless of how
// wide color-emoji glyphs render on the user's device. We position each game at a
// computed cell center instead of trusting measureText on emoji (which lies).

import { describe, expect, test } from 'vitest';
import { gamesStripLayout } from './posterLayout';

const TOTAL = 1080;
const MARGIN = 90;

describe('gamesStripLayout', () => {
  // A run can have 4 (out in pool) to 7 (full bracket) games; guard the whole range.
  for (const count of [1, 3, 4, 5, 6, 7]) {
    test(`every cell stays inside the safe area for ${count} games`, () => {
      const { cellWidth, centers } = gamesStripLayout(count, { totalWidth: TOTAL, margin: MARGIN });
      expect(centers).toHaveLength(count);
      const first = centers[0] - cellWidth / 2;
      const last = centers[centers.length - 1] + cellWidth / 2;
      expect(first).toBeGreaterThanOrEqual(MARGIN - 0.01);
      expect(last).toBeLessThanOrEqual(TOTAL - MARGIN + 0.01);
    });

    test(`the strip is centered on the canvas for ${count} games`, () => {
      const { centers } = gamesStripLayout(count, { totalWidth: TOTAL, margin: MARGIN });
      const mid = (centers[0] + centers[centers.length - 1]) / 2;
      expect(mid).toBeCloseTo(TOTAL / 2, 5);
    });

    test(`cells are evenly spaced for ${count} games`, () => {
      const { centers } = gamesStripLayout(count, { totalWidth: TOTAL, margin: MARGIN });
      if (count < 2) return;
      const gaps = centers.slice(1).map((c, i) => c - centers[i]);
      for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 5);
    });
  }

  test('font size scales down for crowded strips but never exceeds the base size', () => {
    const base = gamesStripLayout(4, { totalWidth: TOTAL, margin: MARGIN });
    const crowded = gamesStripLayout(7, { totalWidth: TOTAL, margin: MARGIN });
    expect(base.fontSize).toBeLessThanOrEqual(44);
    expect(crowded.fontSize).toBeLessThanOrEqual(base.fontSize);
    // even crowded, the pair should be comfortably narrower than its cell
    expect(crowded.fontSize).toBeLessThan(crowded.cellWidth);
  });

  test('a single game sits dead center', () => {
    const { centers } = gamesStripLayout(1, { totalWidth: TOTAL, margin: MARGIN });
    expect(centers[0]).toBeCloseTo(TOTAL / 2, 5);
  });
});
