// AdSense for the website: one responsive unit on calm screens only (title
// bottom, result bottom), never during the draft or the sim reveal. It renders
// nothing at all until ADSENSE_CLIENT and the slot ids are filled in (see
// README "Monetization"). The portal build never loads AdSense: a portal runs
// its own ads, and the early return compiles this whole path out of that bundle.

import { IS_PORTAL } from '../portal';

export const ADSENSE_CLIENT = 'ca-pub-4879291425090726';
const AD_SLOTS: Record<'title' | 'result', string> = {
  title: '', // slot id from AdSense → Ads → By ad unit
  result: '',
};

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

let scriptInjected = false;

export function mountAd(container: HTMLElement, placement: 'title' | 'result'): void {
  if (IS_PORTAL) return;
  if (!ADSENSE_CLIENT || !AD_SLOTS[placement]) return;
  if (!scriptInjected) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
    script.crossOrigin = 'anonymous';
    document.head.append(script);
    scriptInjected = true;
  }
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = ADSENSE_CLIENT;
  ins.dataset.adSlot = AD_SLOTS[placement];
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  container.append(ins);
  try {
    (window.adsbygoogle = window.adsbygoogle ?? []).push({});
  } catch {
    // ads are never worth an error
  }
}
