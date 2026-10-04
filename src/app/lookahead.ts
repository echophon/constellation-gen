import { pulsesToSeconds, secondsToPulses, type MainClock } from '../engine/index';

/** How far ahead of the audio clock voices are queued, in seconds. */
export const LOOKAHEAD = 0.12;

/** How far playback has been queued: which pass of the loop, and up to which pulse of it. */
export interface Queued {
  loop: number;
  to: number;
}

export interface Window {
  /** Pulses, half-open: [from, to). */
  from: number;
  to: number;
  /** Seconds from the start of playback to the start of this pass of the loop. */
  base: number;
}

/**
 * The next stretch of the loop to queue, given the seconds since playback
 * started, or null when it is all queued already. Consecutive calls never
 * overlap, at any tempo. Updates `queued`.
 */
export function nextWindow(clock: MainClock, elapsed: number, horizon: number, queued: Queued): Window | null {
  const length = pulsesToSeconds(clock, horizon);
  const loop = Math.floor(elapsed / length);
  const base = loop * length;
  if (loop !== queued.loop) {
    // wrapped past the horizon
    queued.loop = loop;
    queued.to = 0;
  }
  const from = Math.max(queued.to, secondsToPulses(clock, elapsed - base));
  const to = Math.min(horizon, secondsToPulses(clock, elapsed - base + LOOKAHEAD));
  if (to <= from) return null;
  queued.to = to;
  return { from, to, base };
}
