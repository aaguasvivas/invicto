// CrazyGames portal glue. Real only in the portal build (built with
// vite.portal.config.ts, which defines VITE_PORTAL); a no-op everywhere else.
// Every SDK call is guarded: the game must behave identically when the SDK is
// missing, disabled, or throwing (their SDK runs in demo mode on localhost and
// is disabled on other domains).

export const IS_PORTAL = import.meta.env.VITE_PORTAL === 'crazygames';

interface CrazySDK {
  init(): Promise<void>;
  game: {
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart(): void;
    loadingStop(): void;
    happytime(): void;
  };
}

function sdk(): CrazySDK | null {
  if (!IS_PORTAL) return null;
  return (window as unknown as { CrazyGames?: { SDK?: CrazySDK } }).CrazyGames?.SDK ?? null;
}

export async function portalInit(): Promise<void> {
  try {
    await sdk()?.init();
  } catch {
    // SDK is best-effort
  }
}

export function portalLoadingStart(): void {
  try {
    sdk()?.game.loadingStart();
  } catch {
    // best-effort
  }
}

export function portalLoadingStop(): void {
  try {
    sdk()?.game.loadingStop();
  } catch {
    // best-effort
  }
}

export function portalGameplayStart(): void {
  try {
    sdk()?.game.gameplayStart();
  } catch {
    // best-effort
  }
}

export function portalGameplayStop(): void {
  try {
    sdk()?.game.gameplayStop();
  } catch {
    // best-effort
  }
}

/** CrazyGames site-wide celebration; reserved for the INVICTO moment only. */
export function portalHappytime(): void {
  try {
    sdk()?.game.happytime();
  } catch {
    // best-effort
  }
}
