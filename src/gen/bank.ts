import { evolve } from './evolve';
import { draw, generateSlot, type Generated } from './generate';
import type { Genre } from './genres';
import { nextSeed, rng } from './rng';

export const SLOT_COUNT = 20;

/** Each drawn Save Slot is followed by evolutions of it, nearest first. */
const FAMILY_AMOUNTS = [0.15, 0.35, 0.6, 0.85];

export interface GeneratedBank {
  genre: string;
  seed: number;
  slots: Generated[];
}

/**
 * A Bank of Save Slots in the Genre, as four families: buttons 1, 6, 11 and
 * 16 are drawn fresh, and the four after each are evolutions of it, further
 * away button by button. All share one BPM and swing, and so can be swapped
 * in Live Mode without a Reset.
 */
export function generateBank(genre: Genre, seed: number): GeneratedBank {
  const r = rng(seed);
  const clock = { bpm: draw(r, genre.bpm), swing: draw(r, genre.swing) };
  const slots: Generated[] = [];
  while (slots.length < SLOT_COUNT) {
    const parent = generateSlot(genre, nextSeed(r), clock);
    slots.push(parent);
    for (const amount of FAMILY_AMOUNTS) {
      if (slots.length < SLOT_COUNT) slots.push(evolve(genre, parent, { seed: nextSeed(r), amount }));
    }
  }
  return { genre: genre.id, seed, slots: slots.map(({ slot, genotype }) => ({ slot, genotype })) };
}
