// Tasteful ads, 82-0 style: a single responsive unit on calm screens only
// (title bottom, result bottom) — never during the draft or the sim reveal.
// Fully disabled until ADSENSE_CLIENT and the slot ids are filled in (see
// README "Monetization") — until then this renders nothing at all.

export const ADSENSE_CLIENT = ''; // e.g. 'ca-pub-1234567890123456'
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
