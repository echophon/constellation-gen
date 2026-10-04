import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ChannelRenderer,
  combinedEdges,
  defaultSaveSlot,
  euclid,
  parseSaveSlot,
  patternPulses,
  patternSteps,
  pulsesToSeconds,
  secondsToPulses,
  type Edge,
  type Pattern,
  type SaveSlot,
} from '../src/engine/index';

const draw = (steps: boolean[]) => steps.map((s) => (s ? 'x' : '.')).join('');
const pat = (over: Partial<Pattern>): Pattern => ({ mute: 0, chance: 100, length: 8, events: 1, rotate: 0, burst: 1, ratchet: 1, divide: 1, ...over });

/** A Save Slot whose Channel I holds the given Patterns; the rest stay default. */
function slotWith(patterns: Partial<Pattern>[], channel: Partial<SaveSlot['channels'][0]> = {}): SaveSlot {
  const slot = defaultSaveSlot();
  const ch = slot.channels[0]!;
  Object.assign(ch, channel);
  ch.patterns = ch.patterns.map((p, i) => (patterns[i] ? pat(patterns[i]!) : { ...p, mute: 1 }));
  return slot;
}

const rises = (edges: Edge[]) => edges.filter((e) => e.high).map((e) => e.t);
const output = (slot: SaveSlot, to: number) => new ChannelRenderer(0).advance(slot, to);

describe('euclid', () => {
  it('matches the manual (p6, p9)', () => {
    expect(draw(euclid(9, 3))).toBe('x..x..x..');
    expect(draw(euclid(8, 3))).toBe('x..x..x.');
    expect(draw(euclid(16, 5))).toBe('x..x..x..x..x...');
  });

  it('matches well-known rhythms', () => {
    expect(draw(euclid(8, 5))).toBe('x.xx.xx.');
    expect(draw(euclid(16, 4))).toBe('x...x...x...x...');
    expect(draw(euclid(12, 7))).toBe('x.xx.x.xx.x.');
  });

  it('always places exactly `events` Events', () => {
    for (let n = 1; n <= 40; n++) {
      for (let k = 0; k <= n; k++) {
        const steps = euclid(n, k);
        expect(steps).toHaveLength(n);
        expect(steps.filter(Boolean)).toHaveLength(k);
      }
    }
  });

  it('rotates later, as in the manual (p6)', () => {
    expect(draw(patternSteps(pat({ events: 3, rotate: 1 })))).toBe('.x..x..x');
    expect(draw(patternSteps(pat({ events: 3, rotate: 2 })))).toBe('x.x..x..');
  });

  it('bursts onto the following steps (p11, Pattern 1)', () => {
    const steps = patternSteps(pat({ length: 32, rotate: 28, burst: 4 }));
    expect(steps.flatMap((s, i) => (s ? [i] : []))).toEqual([28, 29, 30, 31]);
  });

  it('treats file values the module accepts but the panel cannot set', () => {
    expect(draw(patternSteps(pat({ length: 4, events: 40 })))).toBe('xxxx');
    expect(draw(patternSteps(pat({ events: 3, rotate: 9 })))).toBe('.x..x..x');
  });
});

describe('Pattern Pulses', () => {
  it('shapes each Event into a Pulse of Width percent of a step', () => {
    const slot = slotWith([{ length: 4 }]);
    expect(patternPulses(slot, 0, 0, 0, 8)).toEqual([
      { start: 0, end: 0.5 },
      { start: 4, end: 4.5 },
      { start: 8, end: 8.5 },
    ]);
  });

  it('ratchets between steps and bursts across them (manual p8)', () => {
    const slot = slotWith([{ length: 4, burst: 2, ratchet: 3 }]);
    const starts = patternPulses(slot, 0, 0, 0, 3.99).map((p) => +p.start.toFixed(6));
    expect(starts).toEqual([0, 0.333333, 0.666667, 1, 1.333333, 1.666667]);
  });

  it('blends neighbouring Pulses at Width 100', () => {
    const slot = slotWith([{ length: 8, burst: 3, ratchet: 2 }], { width: 100 });
    expect(patternPulses(slot, 0, 0, 0, 7)).toEqual([{ start: 0, end: 3 }]);
  });

  it('follows the clock tree: Channel scaler then Pattern Divide', () => {
    // Channel ×3 ÷2 (triplets), Pattern ÷2: one step every 4/3 pulses.
    const slot = slotWith([{ length: 2, divide: 2 }], { ratchet: 3, divide: 2 });
    const starts = patternPulses(slot, 0, 0, 0, 5).map((p) => +p.start.toFixed(6));
    expect(starts).toEqual([0, 2.666667]);
  });

  it('delays the output by Channel Rotate percent of a Channel Clock step', () => {
    const slot = slotWith([{ length: 4 }], { rotate: 25 });
    expect(patternPulses(slot, 0, 0, 0, 4)[0]).toEqual({ start: 0.25, end: 0.75 });
  });

  it('is silent when a zero leaves it without a clock', () => {
    expect(patternPulses(slotWith([{ divide: 256 }]), 0, 0, 0, 64)).toEqual([]);
    expect(patternPulses(slotWith([{}], { ratchet: 0 }), 0, 0, 0, 64)).toEqual([]);
    expect(patternPulses(slotWith([{}], { divide: 0 }), 0, 0, 0, 64)).toEqual([]);
  });

  it('wraps Pattern ratchet into one byte like the firmware (300 becomes 44)', () => {
    const slot = slotWith([{ length: 1, ratchet: 300 }]);
    expect(patternPulses(slot, 0, 0, 0, 0.999)).toHaveLength(44);
  });

  it('thins Events by Chance, repeatably for a seed', () => {
    const slot = slotWith([{ length: 1, chance: 50 }]);
    const a = patternPulses(slot, 0, 0, 0, 1000, { seed: 7 });
    expect(a.length).toBeGreaterThan(420);
    expect(a.length).toBeLessThan(580);
    expect(patternPulses(slot, 0, 0, 0, 1000, { seed: 7 })).toEqual(a);
    expect(patternPulses(slot, 0, 0, 0, 1000, { seed: 8 })).not.toEqual(a);
  });
});

describe('Channel Logic', () => {
  const two = [{ events: 3 }, { events: 4 }]; // x..x..x. and x.x.x.x.

  it('ORs unmuted Patterns', () => {
    expect(rises(output(slotWith(two, { logic: 'OR' }), 8))).toEqual([0, 2, 3, 4, 6]);
  });

  it('ANDs unmuted Patterns', () => {
    expect(rises(output(slotWith(two, { logic: 'AND' }), 8))).toEqual([0, 6]);
  });

  it('XORs unmuted Patterns', () => {
    expect(rises(output(slotWith(two, { logic: 'XOR' }), 8))).toEqual([2, 3, 4]);
  });

  it('leaves muted Patterns out of AND', () => {
    const slot = slotWith([{ events: 3 }, { events: 4 }, { events: 0, mute: 1 }], { logic: 'AND' });
    expect(rises(output(slot, 8))).toEqual([0, 6]);
  });

  it('combines Pulses in continuous time, so partial overlaps count', () => {
    // P1 steps twice as slowly, so its Pulse is [0, 1); P2's Pulses are [0, .5) and [1, 1.5) ...
    const slot = slotWith([{ length: 2, divide: 2 }, { length: 1 }], { logic: 'XOR' });
    // At t = 1, P1 falls and P2 rises together: one high Pattern before and after, so XOR stays high.
    expect(output(slot, 2)).toEqual([
      { t: 0.5, high: true },
      { t: 1.5, high: false },
    ]);
  });

  it('outputs nothing from a muted Channel', () => {
    expect(output(slotWith(two, { mute: 1 }), 8)).toEqual([]);
  });

  it('toggles on each rising edge with Flop', () => {
    expect(output(slotWith([{ length: 4 }], { flop: 1 }), 16)).toEqual([
      { t: 0, high: true },
      { t: 4, high: false },
      { t: 8, high: true },
      { t: 12, high: false },
    ]);
  });
});

describe('windows', () => {
  const file = join(__dirname, '..', '000', '00.TXT');
  const factory = parseSaveSlot(readFileSync(file, 'utf8'));
  const busy = slotWith(
    [
      { length: 7, events: 3, ratchet: 3, chance: 60 },
      { length: 16, events: 5, burst: 2, divide: 3 },
      { length: 5, events: 2, rotate: 3, ratchet: 255 },
    ],
    { logic: 'XOR', ratchet: 3, divide: 2, width: 100, rotate: 40, flop: 1 },
  );

  it.each([
    ['factory slot 00', factory],
    ['a dense polymetric Channel', busy],
  ])('joins up without gaps or repeats: %s', (_, slot) => {
    for (let c = 0; c < 8; c++) {
      const whole = new ChannelRenderer(c, { seed: 3 }).advance(slot, 96);
      const pieces = new ChannelRenderer(c, { seed: 3 });
      const joined: Edge[] = [];
      for (let t = 0; t < 96; ) {
        t = Math.min(96, t + [0.37, 1, 2.5, 0.01, 4][joined.length % 5]!);
        joined.push(...pieces.advance(slot, t));
      }
      expect(joined.length).toBe(whole.length);
      joined.forEach((e, i) => {
        expect(e.high).toBe(whole[i]!.high);
        expect(e.t).toBeCloseTo(whole[i]!.t, 6);
      });
    }
  });

  it('alternates rise and fall', () => {
    const { initial, edges } = combinedEdges(busy, 0, 0, 200, { seed: 1 });
    let level = initial;
    for (const e of edges) {
      expect(e.high).toBe(!level);
      level = e.high;
    }
  });

  it('plays the factory kick on every beat', () => {
    expect(rises(new ChannelRenderer(0).advance(factory, 16))).toEqual([0, 4, 8, 12]);
  });
});

describe('Main Clock', () => {
  const clock = defaultSaveSlot().clock;

  it('runs sixteenth notes at 120 bpm by default', () => {
    expect(pulsesToSeconds(clock, 4)).toBeCloseTo(0.5, 9);
    expect(pulsesToSeconds(clock, 16)).toBeCloseTo(2, 9);
  });

  it('swings alternate pulses and keeps the pair length', () => {
    const swung = { ...clock, swing: 66 };
    expect(pulsesToSeconds(swung, 1)).toBeCloseTo(0.25 * 0.66, 9);
    expect(pulsesToSeconds(swung, 2)).toBeCloseTo(0.25, 9);
  });

  it('inverts', () => {
    for (const swing of [50, 66, 90]) {
      for (const p of [0, 0.3, 1, 1.7, 2, 13.37, 400.5]) {
        const c = { ...clock, bpm: 97, ratchet: 5, divide: 3, swing };
        expect(secondsToPulses(c, pulsesToSeconds(c, p))).toBeCloseTo(p, 6);
      }
    }
  });
});
