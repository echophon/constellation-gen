import { patternSteps } from '../engine/euclid';
import { PATTERN_COUNT, type Channel, type Pattern } from '../format/saveSlot';

// Finds the fewest Patterns whose combined Output Signal has an Event on
// exactly the given steps. Every Pattern it returns runs at Divide 1 and
// Ratchet 1, and has a Length that divides the number of steps, so the result
// loops with the input. See research/genre-patterns.md.

export type FitPattern = Pick<Pattern, 'length' | 'events' | 'rotate' | 'burst'>;

export interface Fit {
  logic: 'OR' | 'XOR';
  patterns: FitPattern[];
}

export interface FitOptions {
  /**
   * 'any', the default, takes whichever needs fewer Patterns, OR on a tie.
   * XOR is often smaller: two Patterns high at the same time cancel (manual
   * p17), so one Pattern can remove or move another's Events.
   */
  logic?: 'OR' | 'XOR' | 'any';
  /** Defaults to the 8 Patterns of a Channel. */
  maxPatterns?: number;
}

/** Reads "x..x..x." into steps. x or X is an Event; . or - is a rest; spaces and | are ignored. */
export function parseSteps(text: string): boolean[] {
  const steps: boolean[] = [];
  for (const ch of text) {
    if (ch === 'x' || ch === 'X') steps.push(true);
    else if (ch === '.' || ch === '-') steps.push(false);
    else if (!/[\s|]/.test(ch)) throw new Error(`"${ch}" is not a step`);
  }
  return steps;
}

interface Candidate {
  mask: bigint;
  /** Number of steps with an Event. */
  size: number;
  pattern: FitPattern;
}

/**
 * Every distinct loop one Pattern can make over `loop` steps. Simpler
 * Patterns are generated first, so they win when two make the same loop.
 */
function candidates(loop: number): Candidate[] {
  const byMask = new Map<bigint, Candidate>();
  for (let length = 1; length <= loop; length++) {
    if (loop % length !== 0) continue;
    for (let events = 1; events <= length; events++) {
      // The panel caps Burst at the room between Events.
      const maxBurst = Math.floor(length / events);
      for (let burst = 1; burst <= maxBurst; burst++) {
        for (let rotate = 0; rotate < length; rotate++) {
          const pattern = { length, events, rotate, burst };
          const steps = patternSteps(pattern);
          let mask = 0n;
          let size = 0;
          for (let i = 0; i < loop; i++) {
            if (!steps[i % length]) continue;
            mask |= 1n << BigInt(i);
            size++;
          }
          if (!byMask.has(mask)) byMask.set(mask, { mask, size, pattern });
        }
      }
    }
  }
  return [...byMask.values()];
}

function popCount(mask: bigint): number {
  let n = 0;
  for (; mask; mask &= mask - 1n) n++;
  return n;
}

function lowestBit(mask: bigint): number {
  let i = 0;
  while (!((mask >> BigInt(i)) & 1n)) i++;
  return i;
}

/** Exact cover by Patterns that add no stray Event, fewest first. */
function fitOr(target: bigint, all: Candidate[], max: number): FitPattern[] | null {
  const usable = all.filter((c) => (c.mask & ~target) === 0n).sort((a, b) => b.size - a.size);
  if (usable.length === 0) return null;
  const biggest = usable[0]!.size;
  const covering = new Map<number, Candidate[]>();
  for (const c of usable) {
    for (let m = c.mask; m; m &= m - 1n) {
      const bit = lowestBit(m);
      let list = covering.get(bit);
      if (!list) covering.set(bit, (list = []));
      list.push(c);
    }
  }

  const search = (uncovered: bigint, left: number): FitPattern[] | null => {
    if (!uncovered) return [];
    if (popCount(uncovered) > left * biggest) return null;
    for (const c of covering.get(lowestBit(uncovered)) ?? []) {
      const rest = search(uncovered & ~c.mask, left - 1);
      if (rest) return [c.pattern, ...rest];
    }
    return null;
  };

  for (let limit = 1; limit <= max; limit++) {
    const found = search(target, limit);
    if (found) return found;
  }
  return null;
}

// Above these candidate counts the three- and four-Pattern XOR searches are skipped.
const XOR_TRIPLE_LIMIT = 2000;
const XOR_QUAD_LIMIT = 700;

/** Fewest Patterns whose symmetric difference is the target; gives up beyond four. */
function fitXor(target: bigint, all: Candidate[], max: number): FitPattern[] | null {
  const byMask = new Map(all.map((c) => [c.mask, c]));
  const single = byMask.get(target);
  if (single && max >= 1) return [single.pattern];

  if (max >= 2) {
    for (const a of all) {
      const b = byMask.get(target ^ a.mask);
      if (b) return [a.pattern, b.pattern];
    }
  }
  if (max >= 3 && all.length <= XOR_TRIPLE_LIMIT) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const c = byMask.get(target ^ all[i]!.mask ^ all[j]!.mask);
        if (c) return [all[i]!.pattern, all[j]!.pattern, c.pattern];
      }
    }
  }
  if (max >= 4 && all.length <= XOR_QUAD_LIMIT) {
    const pairs = new Map<bigint, [Candidate, Candidate]>();
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const mask = all[i]!.mask ^ all[j]!.mask;
        if (!pairs.has(mask)) pairs.set(mask, [all[i]!, all[j]!]);
      }
    }
    for (const [mask, [a, b]] of pairs) {
      const other = pairs.get(target ^ mask);
      if (other) return [a.pattern, b.pattern, other[0].pattern, other[1].pattern];
    }
  }
  return null;
}

/**
 * The fewest Patterns that put an Event on exactly the given steps, or null
 * when none is found within `maxPatterns`. No steps set gives no Patterns.
 */
export function fitSteps(steps: boolean[], options: FitOptions = {}): Fit | null {
  const logic = options.logic ?? 'any';
  const max = options.maxPatterns ?? PATTERN_COUNT;
  let target = 0n;
  steps.forEach((on, i) => {
    if (on) target |= 1n << BigInt(i);
  });
  if (!target) return { logic: 'OR', patterns: [] };

  const all = candidates(steps.length);
  const or = logic === 'XOR' ? null : fitOr(target, all, max);
  const xor = logic === 'OR' ? null : fitXor(target, all, max);
  if (or && (!xor || or.length <= xor.length)) return { logic: 'OR', patterns: or };
  return xor ? { logic: 'XOR', patterns: xor } : null;
}

/**
 * A copy of the Channel playing the fit: its Logic, the fitted Patterns
 * first at Chance 100, and every other Pattern muted.
 */
export function withFit(channel: Channel, fit: Fit): Channel {
  return {
    ...channel,
    logic: fit.logic,
    patterns: channel.patterns.map((p, i) => {
      const fitted = fit.patterns[i];
      return fitted ? { mute: 0, chance: 100, ...fitted, ratchet: 1, divide: 1 } : { ...p, mute: 1 };
    }),
  };
}
