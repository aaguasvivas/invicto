// Optional crowd roar, synthesized with WebAudio (no assets). Off by default.
// Haptics live here too: same "ambient feedback" job, same best-effort rules.

import { soundOn } from '../game/state';

let ctx: AudioContext | null = null;

/** Haptic tick(s); silent no-op where the Vibration API is unavailable. */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // haptics are best-effort
  }
}

export function crowdRoar(intensity = 1): void {
  if (!soundOn()) return;
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
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
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // audio is best-effort
  }
}
