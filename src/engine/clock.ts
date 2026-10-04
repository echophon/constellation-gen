import type { MainClock } from '../format/saveSlot';

// The engine measures time in Main Clock pulses since Reset ("pulses").
// These functions map pulses to seconds for the internal clock.

/** Average Main Clock pulses per second: BPM × ratchet ÷ divide. */
export function pulsesPerSecond(clock: MainClock): number {
  const divide = clock.divide || 1;
  return (clock.bpm / 60) * (clock.ratchet / divide);
}

function swingRatio(clock: MainClock): number {
  return Math.min(90, Math.max(50, clock.swing)) / 100;
}

/**
 * Seconds since Reset at a given pulse position. Swing lengthens every even
 * pulse and shortens every odd one, keeping each pair's total duration.
 */
export function pulsesToSeconds(clock: MainClock, pulses: number): number {
  const pair = 2 / pulsesPerSecond(clock);
  const s = swingRatio(clock);
  const whole = Math.floor(pulses / 2);
  const frac = pulses - whole * 2;
  const within = frac < 1 ? frac * s : s + (frac - 1) * (1 - s);
  return (whole + within) * pair;
}

export function secondsToPulses(clock: MainClock, seconds: number): number {
  const pair = 2 / pulsesPerSecond(clock);
  const s = swingRatio(clock);
  const pairs = seconds / pair;
  const whole = Math.floor(pairs);
  const frac = pairs - whole;
  const within = frac < s ? frac / s : 1 + (frac - s) / (1 - s);
  return whole * 2 + within;
}
