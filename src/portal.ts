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
    /** A link to the game's CrazyGames page carrying these params (sync or async across SDK versions). */
    inviteLink?(params: Record<string, string>): string | Promise<string>;
    /** A param of the invite link this page was opened from. */
    getInviteParam?(name: string): string | null | Promise<string | null>;
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

/** The SDK can make invite links, so a challenge can be shared without naming another site. */
export function portalCanInvite(): boolean {
  try {
    return typeof sdk()?.game.inviteLink === 'function';
  } catch {
    return false;
  }
}

/**
 * A challenge link that stays on CrazyGames: their invite link to the game's
 * page with the code as its r param. Null without the SDK or the call, and
 * then the share carries no link at all (a portal build never names our site).
 */
export async function portalInviteLink(code: string): Promise<string | null> {
  try {
    const link = await Promise.resolve(sdk()?.game.inviteLink?.({ r: code }));
    return typeof link === 'string' && link ? link : null;
  } catch {
    return null; // best-effort
  }
}

/** The challenge code of the invite link this page was opened from, if any. */
export async function portalInviteParam(): Promise<string | null> {
  try {
    const value = await Promise.resolve(sdk()?.game.getInviteParam?.('r'));
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null; // best-effort
  }
}
