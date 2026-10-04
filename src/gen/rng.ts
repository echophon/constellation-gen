// Seeded randomness, so a genre and a seed always give the same Save Slot.

export type Rng = () => number;

/** mulberry32: values in [0, 1). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** An integer in [lo, hi]. */
export const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

export const pick = <T>(r: Rng, items: readonly T[]): T => items[Math.floor(r() * items.length)]!;

/** Picks by weight; a missing weight counts as 1. */
export function pickWeighted<T extends { weight?: number }>(r: Rng, items: readonly T[]): T {
  let at = r() * items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  for (const item of items) {
    at -= item.weight ?? 1;
    if (at < 0) return item;
  }
  return items[items.length - 1]!;
}

/** A fresh 32-bit seed. */
export const nextSeed = (r: Rng) => Math.floor(r() * 0x100000000);
