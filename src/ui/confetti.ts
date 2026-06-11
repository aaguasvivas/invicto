// CSS confetti: subtle multicolor for CAMPEÓN, big gold + screen flash for INVICTO.

import { h } from './dom';

const CAMPEON_COLORS = ['#f5b942', '#3ddc84', '#ff5d73', '#6ea8ff', '#ffd87a'];
const INVICTO_COLORS = ['#f5b942', '#ffd87a', '#fff3c4', '#e8a52c'];

export function confetti(kind: 'campeon' | 'invicto'): void {
  const colors = kind === 'invicto' ? INVICTO_COLORS : CAMPEON_COLORS;
  const count = kind === 'invicto' ? 140 : 70;
  if (kind === 'invicto') {
    const flash = h('div.flash');
    document.body.append(flash);
    setTimeout(() => flash.remove(), 800);
  }
  const layer = h('div.confetti-layer');
  for (let i = 0; i < count; i++) {
    const piece = h('div.confetti-piece');
    piece.style.setProperty('--x', `${Math.random() * 100}vw`);
    piece.style.setProperty('--c', colors[Math.floor(Math.random() * colors.length)]);
    piece.style.setProperty('--d', `${2.2 + Math.random() * 2.4}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.9}s`);
    piece.style.setProperty('--r', `${360 + Math.random() * 720}deg`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 6200);
}
