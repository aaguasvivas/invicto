// CrazyGames portal glue. Real only in the portal build (built with
// vite.portal.config.ts, which defines VITE_PORTAL); a no-op everywhere else.
// Every SDK call is guarded: the game must behave identically when the SDK is
// missing, disabled, or throwing (their SDK runs in demo mode on localhost and
// is disabled on other domains).

import { adoptHostLocale } from './i18n';
import { setHostMuted } from './ui/sound';

export const IS_PORTAL = import.meta.env.VITE_PORTAL === 'crazygames';

interface CrazySettings {
  muteAudio: boolean;
}

interface CrazySDK {
  init(): Promise<void>;
  user: { systemInfo: { locale?: string } };
  game: {
    settings: CrazySettings;
    addSettingsChangeListener(listener: (settings: CrazySettings) => void): void;
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

/**
 * Start the SDK, then take two settings from the player's CrazyGames account:
 * their language (unless they picked one in the game) and the site's mute
 * button, which outranks the game's own sound toggle. Runs before the first
 * screen renders, so the title already shows in that language.
 */
export async function portalInit(): Promise<void> {
  const crazy = sdk();
  if (!crazy) return;
  try {
    await crazy.init();
  } catch {
    return; // SDK is best-effort
  }
  try {
    adoptHostLocale(crazy.user.systemInfo.locale);
  } catch {
    // best-effort
  }
  try {
    setHostMuted(crazy.game.settings.muteAudio === true);
    crazy.game.addSettingsChangeListener((settings) => setHostMuted(settings.muteAudio === true));
  } catch {
    // best-effort
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

let gameplayActive = false;

export function portalGameplayStart(): void {
  gameplayActive = true;
  try {
    sdk()?.game.gameplayStart();
  } catch {
    // best-effort
  }
}

/** Only meaningful after a start; the title screen at boot must not emit a
    stop-with-no-start (their QA detector reads that as a broken integration). */
export function portalGameplayStop(): void {
  if (!gameplayActive) return;
  gameplayActive = false;
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
