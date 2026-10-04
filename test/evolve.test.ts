import { describe, expect, it } from 'vitest';
import { defaultSaveSlot, parseSaveSlot, renderSlot, serializeSaveSlot, type SaveSlot } from '../src/engine/index';
import { generateBank } from '../src/gen/bank';
import { distance, evolve, evolveBare } from '../src/gen/evolve';
import { generateSlot, type Generated } from '../src/gen/generate';
import { GENRES, genreById } from '../src/gen/genres';

const SEEDS = Array.from({ length: 25 }, (_, i) => i * 104729 + 3);
const AMOUNTS = [0, 0.15, 0.3, 0.6, 1];
const genre = (id: string) => genreById(id)!;
const text = (slot: SaveSlot) => serializeSaveSlot(slot);

/** Steps on which a Channel rises, playing only its Chance 100 Patterns. */
function certain(slot: SaveSlot, channel: number, pulses: number): number[] {
  const copy = parseSaveSlot(text(slot));
  for (const p of copy.channels[channel]!.patterns) if (p.chance < 100) p.mute = 1;
  return renderSlot(copy, pulses)[channel]!.filter((e) => e.high).map((e) => e.t);
}

/** Evolves again and again, each time from the last result. */
function chain(id: string, seed: number, steps: number, amount: number, more = {}): Generated[] {
  const out: Generated[] = [generateSlot(genre(id), seed)];
  for (let i = 0; i < steps; i++) out.push(evolve(genre(id), out[i]!, { seed: seed + i, amount, ...more }));
  return out;
}

describe('distance', () => {
  const withKick = (over: object) => {
    const slot = defaultSaveSlot();
    Object.assign(slot.channels[0]!.patterns[0]!, { length: 4, events: 1, rotate: 0 }, over);
    return slot;
  };

  it('is 0 for the same Events, even when the settings differ', () => {
    expect(distance(withKick({}), withKick({}))).toBe(0);
    expect(distance(withKick({}), withKick({ length: 8, events: 2 }))).toBe(0);
  });

  it('is 1 when no Event is shared', () => {
    const silent = withKick({ rotate: 2 });
    // Every Channel of the default Save Slot plays the same Pattern; leave only Channel I.
    const a = withKick({});
    for (const s of [a, silent]) s.channels.slice(1).forEach((ch) => (ch.mute = 1));
    expect(distance(a, silent)).toBe(1);
  });

  it('counts kick and snare for more than the other Channels', () => {
    const moved = (c: number) => {
      const slot = defaultSaveSlot();
      slot.channels[c]!.patterns[0]!.rotate = 1;
      return slot;
    };
    expect(distance(defaultSaveSlot(), moved(0))).toBeGreaterThan(distance(defaultSaveSlot(), moved(5)));
  });
});

describe('evolve', () => {
  it('gives the same result for the same seed and leaves the parent alone', () => {
    const parent = generateSlot(genre('techno'), 11);
    const before = JSON.stringify(parent);
    const a = evolve(genre('techno'), parent, { seed: 5, amount: 0.5 });
    expect(evolve(genre('techno'), parent, { seed: 5, amount: 0.5 })).toEqual(a);
    expect(text(evolve(genre('techno'), parent, { seed: 6, amount: 0.5 }).slot)).not.toBe(text(a.slot));
    expect(JSON.stringify(parent)).toBe(before);
  });

  it('always changes something, and stays within the budget for its amount', () => {
    for (const g of GENRES) {
      for (const seed of SEEDS) {
        const parent = generateSlot(g, seed);
        for (const amount of AMOUNTS) {
          const child = evolve(g, parent, { seed: seed + 1, amount });
          const where = `${g.id} seed ${seed} amount ${amount}`;
          expect(text(child.slot), where).not.toBe(text(parent.slot));
          expect(child.distance, where).toBe(distance(parent.slot, child.slot));
          expect(child.distance, where).toBeLessThanOrEqual(0.08 + 0.5 * amount);
          expect(child.slot.clock, where).toEqual(parent.slot.clock);
        }
      }
    }
  });

  it('goes further with a larger amount', () => {
    const mean = (amount: number) => {
      let sum = 0;
      for (const seed of SEEDS) {
        const parent = generateSlot(genre('house'), seed);
        sum += evolve(genre('house'), parent, { seed, amount }).distance;
      }
      return sum / SEEDS.length;
    };
    expect(mean(0.1)).toBeLessThan(mean(0.5));
    expect(mean(0.5)).toBeLessThan(mean(1));
  });

  it('keeps a Genotype that describes the result, so it can be evolved again', () => {
    for (const g of GENRES) {
      const steps = chain(g.id, 9, 6, 0.7);
      steps.forEach(({ slot, genotype }, i) => {
        expect(genotype.generation).toBe(i);
        expect(parseSaveSlot(text(slot))).toEqual(slot);
        slot.channels.forEach((ch, c) => {
          const genes = genotype.channels[c]!;
          const owned = genes.layers.reduce((n, l) => n + l.patterns, 0);
          expect(ch.patterns.filter((p) => !p.mute), `${g.id} step ${i} channel ${c}`).toHaveLength(owned);
          expect(g.roles[c]!.recipes.some((r) => r.id === genes.recipe)).toBe(true);
        });
      });
    }
  });

  it('leaves the anchors alone, however often and however far', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      for (const { slot } of chain('house', seed, 6, 1)) {
        expect(certain(slot, 0, 32)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
        expect(certain(slot, 1, 32)).toEqual([4, 12, 20, 28]);
      }
      for (const { slot } of chain('drill', seed, 6, 1)) {
        expect(certain(slot, 1, 64)).toEqual([8, 28, 40, 60]);
        expect(certain(slot, 2, 16)).toEqual(expect.arrayContaining([0, 3, 6, 8, 11, 14]));
      }
      for (const { slot } of chain('jersey', seed, 6, 1)) expect(certain(slot, 0, 16)).toEqual([0, 4, 8, 11, 14]);
    }
  });

  it('changes anchors only when asked to', () => {
    const kicks = (more: object) =>
      new Set(SEEDS.flatMap((seed) => chain('boombap', seed, 4, 1, more).map(({ slot }) => certain(slot, 0, 16).join(','))));
    const fixed = SEEDS.map((seed) => new Set(chain('boombap', seed, 4, 1).map(({ slot }) => certain(slot, 0, 16).join(','))));
    for (const seen of fixed) expect(seen.size).toBe(1);
    // With anchors unlocked a chain can move between the genre's kick grids.
    const free = SEEDS.map((seed) => new Set(chain('boombap', seed, 4, 1, { anchors: true }).map(({ slot }) => certain(slot, 0, 16).join(','))));
    expect(free.some((seen) => seen.size > 1)).toBe(true);
    expect(kicks({ anchors: true }).size).toBeGreaterThanOrEqual(kicks({}).size);
  });

  it('leaves locked Channels alone', () => {
    const locked = [true, true, false, false, true, false, false, false];
    for (const seed of SEEDS) {
      const parent = generateSlot(genre('idm'), seed);
      const child = evolve(genre('idm'), parent, { seed, amount: 1, locked });
      locked.forEach((lock, c) => {
        if (lock) expect(child.slot.channels[c]).toEqual(parent.slot.channels[c]);
      });
    }
  });

  it('returns the parent when every Channel is locked', () => {
    const parent = generateSlot(genre('dnb'), 4);
    const child = evolve(genre('dnb'), parent, { seed: 1, amount: 1, locked: new Array<boolean>(8).fill(true) });
    expect(child.slot).toEqual(parent.slot);
    expect(child.distance).toBe(0);
  });

  it('keeps Channel Mutes, which are the player\'s', () => {
    const parent = generateSlot(genre('techno'), 3);
    parent.slot.channels[4]!.mute = 1;
    for (const seed of SEEDS) expect(evolve(genre('techno'), parent, { seed, amount: 1 }).slot.channels[4]!.mute).toBe(1);
  });

  it('refuses a Genotype from another Genre', () => {
    expect(() => evolve(genre('house'), generateSlot(genre('idm'), 1), { seed: 1 })).toThrow('does not describe a House Save Slot');
  });
});

describe('evolveBare', () => {
  it('changes a Save Slot that has no Genotype, leaving kick, snare and AND Channels alone', () => {
    for (const g of GENRES) {
      for (const seed of SEEDS.slice(0, 10)) {
        const parent = generateSlot(g, seed).slot;
        const before = text(parent);
        const child = evolveBare(parent, { seed, amount: 0.5 });
        expect(text(parent)).toBe(before);
        expect(text(child.slot), `${g.id} seed ${seed}`).not.toBe(before);
        expect(child.slot.channels[0]).toEqual(parent.channels[0]);
        expect(child.slot.channels[1]).toEqual(parent.channels[1]);
        parent.channels.forEach((ch, c) => {
          if (ch.logic === 'AND') expect(child.slot.channels[c]).toEqual(ch);
        });
        for (const ch of child.slot.channels) {
          for (const p of ch.patterns) {
            expect(p.events).toBeLessThanOrEqual(p.length);
            expect(p.rotate).toBeLessThan(p.length);
            expect(p.burst).toBeLessThanOrEqual(Math.max(1, Math.floor(p.length / p.events)));
          }
        }
      }
    }
  });
});

describe('generateBank', () => {
  it('lays the Bank out as four families, nearest variation first', () => {
    for (const g of GENRES) {
      const { slots } = generateBank(g, 77);
      slots.forEach(({ slot, genotype }, i) => {
        const parent = slots[i - (i % 5)]!;
        expect(genotype.generation, `${g.id} slot ${i}`).toBe(i % 5 === 0 ? 0 : 1);
        expect(genotype.seed).toBe(parent.genotype.seed);
        if (i % 5) {
          expect(text(slot)).not.toBe(text(parent.slot));
          expect(distance(parent.slot, slot)).toBeLessThanOrEqual(0.08 + 0.5 * 0.85);
        }
      });
    }
  });

  it('keeps the genre in every Save Slot', () => {
    for (const { slot } of generateBank(genre('drill'), 5).slots) expect(certain(slot, 1, 64)).toEqual([8, 28, 40, 60]);
    for (const { slot } of generateBank(genre('house'), 5).slots) expect(certain(slot, 0, 16)).toEqual([0, 4, 8, 12]);
  });
});
