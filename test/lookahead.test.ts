import { describe, expect, it } from 'vitest';
import { defaultClock, pulsesToSeconds } from '../src/engine/index';
import { nextWindow, type Queued } from '../src/app/lookahead';

const HORIZON = 64;

/** Every window queued over `seconds` of 60 fps frames. */
function run(bpm: number, seconds: number, swing = 50) {
  const clock = { ...defaultClock(), bpm, swing };
  const queued: Queued = { loop: 0, to: 0 };
  const windows = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
    const w = nextWindow(clock, elapsed, HORIZON, queued);
    if (w) windows.push(w);
  }
  return { clock, windows };
}

describe('nextWindow', () => {
  it('never queues the same pulses twice, at any tempo', () => {
    // Above 125 bpm the look-ahead is longer than one pulse.
    for (const bpm of [60, 120, 126, 174, 300]) {
      const { clock, windows } = run(bpm, 6, 60);
      const at = (w: { base: number }, t: number) => w.base + pulsesToSeconds(clock, t);
      for (let i = 1; i < windows.length; i++) {
        const prev = windows[i - 1]!;
        const next = windows[i]!;
        expect(at(next, next.from), `${bpm} bpm`).toBeGreaterThanOrEqual(at(prev, prev.to) - 1e-9);
      }
    }
  });

  it('queues the whole loop, then starts again from 0', () => {
    const { clock, windows } = run(174, 12);
    const loopSeconds = pulsesToSeconds(clock, HORIZON);
    expect(12 / loopSeconds).toBeGreaterThan(2);
    const first = windows.filter((w) => w.base === 0);
    expect(first[0]!.from).toBe(0);
    expect(first[first.length - 1]!.to).toBe(HORIZON);
    for (let i = 1; i < first.length; i++) expect(first[i]!.from).toBe(first[i - 1]!.to);
    const second = windows.find((w) => w.base > 0)!;
    expect(second.base).toBeCloseTo(loopSeconds);
    expect(second.from).toBeLessThan(2);
  });
});
