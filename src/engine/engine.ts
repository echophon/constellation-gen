import type { Channel, Pattern, SaveSlot } from '../format/saveSlot';
import { patternSteps } from './euclid';

// All times are in Main Clock pulses since Reset. Windows are half-open:
// [from, to). See ASSUMPTIONS.md for what is taken from the manual and not
// yet checked against the module.

export interface Interval {
  start: number;
  end: number;
}

export interface Edge {
  t: number;
  high: boolean;
}

export interface RenderOptions {
  /** Seed for Chance. The same seed always gives the same Events. */
  seed?: number;
}

const EPS = 1e-9;

/** Deterministic value in [0, 1) for one Event, so Chance is a function of time since Reset. */
function chanceRoll(seed: number, channel: number, pattern: number, event: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const v of [channel, pattern, event >>> 0, Math.floor(event / 0x100000000)]) {
    h = Math.imul(h ^ v, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 0x100000000;
}

interface PatternTiming {
  /** Pattern Clock step, in pulses. */
  step: number;
  /** Events per step. */
  ratchet: number;
  /** Pulse duration, in pulses. */
  pulse: number;
  /** Channel output delay, in pulses. */
  delay: number;
}

/** Null when a zero ratchet or divide leaves the Pattern without a clock. */
function patternTiming(channel: Channel, pattern: Pattern): PatternTiming | null {
  // The firmware stores Pattern ratchet and divide in one byte.
  const ratchet = pattern.ratchet & 0xff;
  const divide = pattern.divide & 0xff;
  if (channel.ratchet <= 0 || channel.divide <= 0 || ratchet === 0 || divide === 0) return null;
  const channelStep = channel.divide / channel.ratchet;
  const step = channelStep * divide;
  const width = Math.min(100, Math.max(0, channel.width)) / 100;
  return { step, ratchet, pulse: (step / ratchet) * width, delay: (channel.rotate / 100) * channelStep };
}

/**
 * The Pulses of one Pattern that overlap [from, to], with touching Pulses
 * merged. Ignores the Pattern's own Mute.
 */
export function patternPulses(
  slot: SaveSlot,
  channelIndex: number,
  patternIndex: number,
  from: number,
  to: number,
  options: RenderOptions = {},
): Interval[] {
  const channel = slot.channels[channelIndex]!;
  const pattern = channel.patterns[patternIndex]!;
  const timing = patternTiming(channel, pattern);
  if (!timing || timing.pulse <= 0) return [];

  const steps = patternSteps(pattern);
  const { step, ratchet, pulse, delay } = timing;
  const sub = step / ratchet;
  const seed = options.seed ?? 0;
  const chance = Math.min(100, Math.max(0, pattern.chance)) / 100;

  const first = Math.max(0, Math.floor((from - delay - pulse) / step) - 1);
  const last = Math.ceil((to - delay) / step);
  const out: Interval[] = [];
  for (let k = first; k <= last; k++) {
    if (!steps[k % steps.length]) continue;
    for (let j = 0; j < ratchet; j++) {
      const start = k * step + j * sub + delay;
      const end = start + pulse;
      if (end < from - EPS || start > to + EPS) continue;
      if (chance < 1 && chanceRoll(seed, channelIndex, patternIndex, k * ratchet + j) >= chance) continue;
      const prev = out[out.length - 1];
      if (prev && start <= prev.end + EPS) prev.end = Math.max(prev.end, end);
      else out.push({ start, end });
    }
  }
  return out;
}

function combine(logic: Channel['logic'], high: number, total: number): boolean {
  if (total === 0) return false;
  if (logic === 'AND') return high === total;
  if (logic === 'OR') return high > 0;
  return high % 2 === 1;
}

/**
 * Edges of a Channel's combined Pulses (after Logic, before Flop and Channel
 * Mute) in [from, to), plus the level just before `from`.
 */
export function combinedEdges(
  slot: SaveSlot,
  channelIndex: number,
  from: number,
  to: number,
  options: RenderOptions = {},
): { initial: boolean; edges: Edge[] } {
  const channel = slot.channels[channelIndex]!;
  const active = channel.patterns.flatMap((p, i) => (p.mute ? [] : [i]));

  const changes: { t: number; delta: number }[] = [];
  let high = 0;
  for (const p of active) {
    for (const iv of patternPulses(slot, channelIndex, p, from, to, options)) {
      if (iv.end < from - EPS) continue;
      // A Pulse that started before the window is part of the initial level.
      if (iv.start < from - EPS) high++;
      else changes.push({ t: iv.start, delta: 1 });
      changes.push({ t: iv.end, delta: -1 });
    }
  }
  changes.sort((a, b) => a.t - b.t || a.delta - b.delta);

  const initial = combine(channel.logic, high, active.length);
  const edges: Edge[] = [];
  let level = initial;
  for (let i = 0; i < changes.length; ) {
    const t = changes[i]!.t;
    while (i < changes.length && changes[i]!.t <= t + EPS) high += changes[i++]!.delta;
    if (t >= to - EPS) break;
    const next = combine(channel.logic, high, active.length);
    if (next !== level) {
      edges.push({ t: Math.max(t, from), high: next });
      level = next;
    }
  }
  return { initial, edges };
}

/**
 * Renders one Channel's Output Signal window by window. Windows must be
 * consecutive: Flop depends on every rising edge since Reset, so its state
 * is carried here.
 */
export class ChannelRenderer {
  private position = 0;
  private flop = false;

  constructor(
    private readonly channelIndex: number,
    private readonly options: RenderOptions = {},
  ) {}

  /** Back to Reset. */
  reset(): void {
    this.position = 0;
    this.flop = false;
  }

  get pulses(): number {
    return this.position;
  }

  /** Output Signal edges in [current position, to). The Save Slot may differ between calls. */
  advance(slot: SaveSlot, to: number): Edge[] {
    const channel = slot.channels[this.channelIndex]!;
    const { edges } = combinedEdges(slot, this.channelIndex, this.position, to, this.options);
    this.position = to;

    let out = edges;
    if (channel.flop) {
      out = [];
      for (const e of edges) {
        if (!e.high) continue;
        this.flop = !this.flop;
        out.push({ t: e.t, high: this.flop });
      }
    }
    return channel.mute ? [] : out;
  }
}

/** Output Signal edges for every Channel from Reset to `to`. */
export function renderSlot(slot: SaveSlot, to: number, options: RenderOptions = {}): Edge[][] {
  return slot.channels.map((_, c) => new ChannelRenderer(c, options).advance(slot, to));
}
