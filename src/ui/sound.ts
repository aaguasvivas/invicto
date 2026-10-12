// Optional crowd roar, synthesized with WebAudio (no assets). Off by default.
// Haptics live here too: same "ambient feedback" job, same best-effort rules.

import { soundOn } from '../game/state';

let ctx: AudioContext | null = null;
/** Every roar plays through this one output, so a mute reaches a roar already playing. */
let output: GainNode | null = null;
let hostMuted = false;

/**
 * The host site's own mute (CrazyGames' game.settings.muteAudio and its change
 * listener, wired in portal.ts). It outranks the game's sound toggle: while it
 * is on, no roar starts, and one already playing goes silent at once.
 */
export function setHostMuted(muted: boolean): void {
  hostMuted = muted;
  if (output) output.gain.value = muted ? 0 : 1;
}

/**
 * Create and resume the AudioContext from inside a user gesture. iOS keeps a
 * context suspended unless it was unlocked by a tap; the roars fire from timers,
 * so the sound toggle itself has to do the unlocking.
 */
export function unlockAudio(): void {
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // audio is best-effort
  }
}

/** Haptic tick(s); silent no-op where the Vibration API is unavailable. */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // haptics are best-effort
  }
}

export function crowdRoar(intensity = 1): void {
  if (!soundOn() || hostMuted) return;
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!output) {
      output = ctx.createGain();
      output.connect(ctx.destination);
    }
    const duration = 1.6 * intensity;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25 * intensity, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(output);
    source.start();
  } catch {
    // audio is best-effort
  }
}
