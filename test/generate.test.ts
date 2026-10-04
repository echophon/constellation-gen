import { describe, expect, it } from 'vitest';
import { parseSaveSlot, renderSlot, serializeSaveSlot, type SaveSlot } from '../src/engine/index';
import { SLOT_COUNT, generateBank } from '../src/gen/bank';
import { generateSlot } from '../src/gen/generate';
import { GENRES, genreById, type Recipe } from '../src/gen/genres';
import { channelHash, genotypeOf, parseSidecar, serializeSidecar, sidecarFor } from '../src/gen/sidecar';

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);
const genre = (id: string) => genreById(id)!;

/** Steps on which a Channel rises over `pulses`, playing only its Chance 100 Patterns. */
function certain(slot: SaveSlot, channel: number, pulses: number): number[] {
  const copy = parseSaveSlot(serializeSaveSlot(slot));
  for (const p of copy.channels[channel]!.patterns) if (p.chance < 100) p.mute = 1;
  return renderSlot(copy, pulses)[channel]!.filter((e) => e.high).map((e) => e.t);
}

describe('genre data', () => {
  it('has unique ids and eight roles each', () => {
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(GENRES.length);
    for (const g of GENRES) expect(g.roles, g.id).toHaveLength(8);
  });

  it('has unique recipe ids within a role, so a Genotype can name one', () => {
    for (const g of GENRES) {
      for (const role of g.roles) {
        const ids = role.recipes.map((r: Recipe) => r.id);
        expect(new Set(ids).size, `${g.id} ${role.name}`).toBe(ids.length);
      }
    }
  });
});

describe('generateSlot', () => {
  it('gives the same Save Slot for the same seed, and different ones for different seeds', () => {
    for (const g of GENRES) {
      const texts = SEEDS.map((s) => serializeSaveSlot(generateSlot(g, s).slot));
      expect(serializeSaveSlot(generateSlot(g, SEEDS[3]!).slot)).toBe(texts[3]);
      expect(new Set(texts).size, g.id).toBeGreaterThan(SEEDS.length / 2);
    }
  });

  it('only writes values the panel allows', () => {
    for (const g of GENRES) {
      for (const seed of SEEDS) {
        const { slot } = generateSlot(g, seed);
        expect(parseSaveSlot(serializeSaveSlot(slot))).toEqual(slot);
        expect(slot.clock.bpm).toBeGreaterThanOrEqual(g.bpm.lo);
        expect(slot.clock.bpm).toBeLessThanOrEqual(g.bpm.hi);
        expect(slot.clock.swing).toBeGreaterThanOrEqual(Math.max(50, g.swing.lo));
        expect(slot.clock.swing).toBeLessThanOrEqual(Math.min(90, g.swing.hi));
        for (const ch of slot.channels) {
          expect(ch.patterns).toHaveLength(8);
          for (const p of ch.patterns) {
            const where = `${g.id} seed ${seed}: ${JSON.stringify(p)}`;
            expect(p.length, where).toBeGreaterThanOrEqual(1);
            expect(p.length, where).toBeLessThanOrEqual(999);
            expect(p.events, where).toBeGreaterThanOrEqual(1);
            expect(p.events, where).toBeLessThanOrEqual(p.length);
            expect(p.rotate, where).toBeLessThan(p.length);
            expect(p.burst, where).toBeLessThanOrEqual(Math.max(1, Math.floor(p.length / p.events)));
            expect(p.chance, where).toBeGreaterThanOrEqual(0);
            expect(p.chance, where).toBeLessThanOrEqual(100);
            for (const v of [p.ratchet, p.divide]) {
              expect(v, where).toBeGreaterThanOrEqual(1);
              expect(v, where).toBeLessThanOrEqual(255);
            }
          }
        }
      }
    }
  });

  it('records which Layer every unmuted Pattern came from', () => {
    for (const g of GENRES) {
      for (const seed of SEEDS) {
        const { slot, genotype } = generateSlot(g, seed);
        expect(genotype).toMatchObject({ genre: g.id, seed, generation: 0 });
        slot.channels.forEach((ch, c) => {
          const genes = genotype.channels[c]!;
          const recipe = g.roles[c]!.recipes.find((r) => r.id === genes.recipe);
          expect(recipe, `${g.id} channel ${c}`).toBeDefined();
          const owned = genes.layers.reduce((n, l) => n + l.patterns, 0);
          expect(ch.patterns.filter((p) => !p.mute)).toHaveLength(owned);
          expect(ch.patterns.slice(owned).every((p) => p.mute === 1)).toBe(true);
          for (const l of genes.layers) expect(recipe!.layers[l.layer]).toBeDefined();
        });
      }
    }
  });

  it('keeps each genre recognisable', () => {
    const everyBar = (steps: number[], bars = 4) => Array.from({ length: bars }, (_, b) => steps.map((s) => s + b * 16)).flat();
    for (const seed of SEEDS) {
      // House: four on the floor, clap on 2 and 4.
      const house = generateSlot(genre('house'), seed).slot;
      expect(certain(house, 0, 64)).toEqual(everyBar([0, 4, 8, 12]));
      expect(certain(house, 1, 64)).toEqual(everyBar([4, 12]));

      // Drill: snare on beat 3 of bar one and beat 4 of bar two; tresillo hats.
      const drill = generateSlot(genre('drill'), seed).slot;
      expect(certain(drill, 1, 64)).toEqual([8, 28, 40, 60]);
      expect(certain(drill, 2, 16)).toEqual([0, 3, 6, 8, 11, 14]);

      // Jersey club: the five-kick bar.
      expect(certain(generateSlot(genre('jersey'), seed).slot, 0, 16)).toEqual([0, 4, 8, 11, 14]);

      // Dembow: the tresillo without its downbeat.
      expect(certain(generateSlot(genre('dembow'), seed).slot, 1, 16)).toEqual([3, 6, 11, 14]);

      // Jungle: the Amen snare moves to the "and" of 4 in bars three and four.
      expect(certain(generateSlot(genre('jungle'), seed).slot, 1, 64)).toEqual([4, 12, 20, 28, 36, 46, 52, 62]);

      // Boom bap and garage swing; drill does not.
      expect(generateSlot(genre('boombap'), seed).slot.clock.swing).toBeGreaterThanOrEqual(58);
      expect(drill.clock.swing).toBe(50);
    }
  });

  it('plays a clave on the clave Channel', () => {
    const claves = ['0,3,6,10,12', '2,4,8,11,14', '0,3,7,10,12'];
    for (const seed of SEEDS) {
      expect(claves).toContain(certain(generateSlot(genre('afrocuban'), seed).slot, 1, 16).join(','));
    }
  });

  it('runs the 12/8 genre on a 3:4 Channel Clock', () => {
    const { slot } = generateSlot(genre('bell'), 1);
    for (const ch of slot.channels) {
      if (ch.patterns.every((p) => p.mute)) continue;
      expect([ch.ratchet, ch.divide]).toEqual([3, 4]);
    }
    // Seven bell strokes to the bar.
    expect(certain(slot, 1, 16)).toHaveLength(7);
  });

  it('fills only at the end of the phrase', () => {
    const fills = SEEDS.map((s) => generateSlot(genre('house'), s)).filter((g) => g.genotype.channels[6]!.recipe === 'fill-4-bars');
    expect(fills.length).toBeGreaterThan(0);
    for (const { slot } of fills) expect(certain(slot, 6, 64)).toEqual([56, 57, 58, 59, 60, 61, 62, 63]);
  });
});

describe('generateBank', () => {
  it('gives 20 different Save Slots on one Main Clock', () => {
    for (const g of GENRES) {
      const bank = generateBank(g, 42);
      expect(bank.slots).toHaveLength(SLOT_COUNT);
      expect(new Set(bank.slots.map((s) => JSON.stringify(s.slot.clock))).size).toBe(1);
      expect(new Set(bank.slots.map((s) => serializeSaveSlot(s.slot))).size, g.id).toBeGreaterThan(SLOT_COUNT / 2);
    }
  });

  it('is reproducible, slot by slot', () => {
    const g = genre('techno');
    const bank = generateBank(g, 42);
    expect(generateBank(g, 42)).toEqual(bank);
    const { slot, genotype } = bank.slots[5]!;
    expect(generateSlot(g, genotype.seed, slot.clock).slot).toEqual(slot);
  });
});

describe('sidecar', () => {
  const bank = generateBank(genre('dnb'), 9);
  const sidecar = parseSidecar(serializeSidecar(sidecarFor(bank)));

  it('round-trips', () => {
    expect(sidecar).toEqual(sidecarFor(bank));
    expect(sidecar).toMatchObject({ version: 1, genre: 'dnb', seed: 9 });
  });

  it('gives a Save Slot its Genotype until its Channels are edited', () => {
    const { slot, genotype } = bank.slots[3]!;
    expect(genotypeOf(sidecar, 3, slot)).toEqual(genotype);

    const retimed = parseSaveSlot(serializeSaveSlot(slot));
    retimed.clock.bpm = 99;
    expect(genotypeOf(sidecar, 3, retimed)).toEqual(genotype);

    const edited = parseSaveSlot(serializeSaveSlot(slot));
    edited.channels[0]!.patterns[0]!.rotate += 1;
    expect(channelHash(edited)).not.toBe(channelHash(slot));
    expect(genotypeOf(sidecar, 3, edited)).toBeNull();
  });

  it('rejects other files', () => {
    expect(() => parseSidecar('{"version":2,"slots":[]}')).toThrow('not a version 1 Bank sidecar');
  });
});

describe('AND recipes', () => {
  const MANY = Array.from({ length: 400 }, (_, i) => i * 31 + 5);
  /** Generated Save Slots whose Channel uses the Recipe. */
  function using(id: string, channel: number, recipe: string): SaveSlot[] {
    const found = MANY.map((s) => generateSlot(genre(id), s)).filter((g) => g.genotype.channels[channel]!.recipe === recipe);
    expect(found.length, `${id} ${recipe}`).toBeGreaterThan(0);
    return found.map((g) => g.slot);
  }
  /** When a Channel rises; with `forced`, every Chance is taken as 100. */
  function rises(slot: SaveSlot, channel: number, pulses: number, forced = true): number[] {
    const copy = parseSaveSlot(serializeSaveSlot(slot));
    if (forced) for (const p of copy.channels[channel]!.patterns) p.chance = 100;
    return renderSlot(copy, pulses)[channel]!.filter((e) => e.high).map((e) => +e.t.toFixed(6));
  }
  const perBar = (times: number[], bar: number, bars: number) =>
    Array.from({ length: bars }, (_, b) => times.filter((t) => t >= b * bar && t < (b + 1) * bar).length);

  it('rests for the fourth bar', () => {
    for (const slot of using('house', 3, 'offbeat-rest-bar-4')) {
      expect(rises(slot, 3, 64)).toEqual([2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46]);
    }
    for (const slot of using('boombap', 6, '8ths-rest-bar-4')) expect(perBar(rises(slot, 6, 64), 16, 4)).toEqual([8, 8, 8, 0]);
  });

  it('plays or rests a whole beat at a time', () => {
    const beats = new Set<number>();
    for (const slot of using('techno', 2, '16ths-by-beat')) {
      // The mask reaches the last 16th of each beat.
      expect(rises(slot, 2, 64)).toHaveLength(64);
      for (const n of perBar(rises(slot, 2, 256, false), 4, 64)) beats.add(n);
    }
    expect([...beats].sort()).toEqual([0, 4]);
  });

  it('plays or rests a whole bar at a time', () => {
    const silent = new Set<boolean>();
    for (const slot of using('trap', 4, 'euclid-by-bar')) {
      const full = perBar(rises(slot, 4, 64), 16, 4);
      expect(new Set(full).size).toBe(1);
      expect(full[0]).toBeGreaterThan(0);
      for (const n of perBar(rises(slot, 4, 256, false), 16, 16)) {
        expect([0, full[0]]).toContain(n);
        silent.add(n === 0);
      }
    }
    expect(silent).toEqual(new Set([true, false]));
  });

  it('reaches the last step of a bar that is not 16 pulses long', () => {
    for (const slot of using('aksak', 4, 'euclid-by-bar')) {
      const events = slot.channels[4]!.patterns[0]!.events;
      expect(perBar(rises(slot, 4, 36), 9, 4)).toEqual([events, events, events, events]);
    }
    for (const slot of using('bell', 4, 'euclid-by-bar')) {
      const events = slot.channels[4]!.patterns[0]!.events;
      expect(perBar(rises(slot, 4, 64), 16, 4)).toEqual([events, events, events, events]);
    }
  });

  it('lets a rhythm through a window', () => {
    for (const slot of using('house', 4, 'euclid-half-bar')) {
      const from = slot.channels[4]!.patterns[1]!.rotate;
      const times = rises(slot, 4, 32);
      expect(times.length).toBeGreaterThan(0);
      for (const t of times) expect((t - from + 16) % 16).toBeLessThan(8);
    }
    for (const slot of using('house', 4, 'euclid-one-beat')) {
      const from = slot.channels[4]!.patterns[1]!.rotate;
      for (const t of rises(slot, 4, 64)) expect((t - from + 16) % 16).toBeLessThan(4);
    }
  });

  it('sounds where two loops coincide', () => {
    for (const slot of using('dnb', 4, 'coincidence')) {
      const [a, b] = slot.channels[4]!.patterns;
      const cycle = a!.length * b!.length;
      expect(rises(slot, 4, cycle * 3)).toEqual([0, cycle, cycle * 2]);
    }
    for (const slot of using('techno', 5, 'polymeter-accents')) {
      const [a, b] = slot.channels[5]!.patterns;
      const first = rises(slot, 5, a!.length * b!.length);
      expect(rises(slot, 5, a!.length * b!.length * 2).slice(first.length)).toEqual(first.map((t) => t + a!.length * b!.length));
    }
  });

  it('rolls in the last beat of the phrase', () => {
    for (const slot of using('house', 6, 'roll-fill')) {
      const [roll, mask] = slot.channels[6]!.patterns;
      const phrase = mask!.length * 4;
      const times = rises(slot, 6, phrase * 2);
      expect(times).toHaveLength(roll!.ratchet * 4 * 2);
      for (const t of times) expect(t % phrase).toBeGreaterThanOrEqual(phrase - 4);
    }
  });

  it('chops a slow gate into a stutter', () => {
    for (const slot of using('techno', 4, 'stutter')) {
      const mask = slot.channels[4]!.patterns[1]!;
      const cycle = mask.length * mask.divide;
      const times = rises(slot, 4, cycle);
      expect(times).toHaveLength(mask.divide / 2);
      expect(times[times.length - 1]! - times[0]!).toBe(mask.divide / 2 - 1);
    }
  });

  it('are left whole by evolve', async () => {
    const { evolve } = await import('../src/gen/evolve');
    for (const slot of using('house', 3, 'offbeat-rest-bar-4').slice(0, 5)) {
      const seed = MANY.find((s) => serializeSaveSlot(generateSlot(genre('house'), s).slot) === serializeSaveSlot(slot))!;
      let step = generateSlot(genre('house'), seed);
      for (let i = 0; i < 6; i++) {
        step = evolve(genre('house'), step, { seed: i, amount: 0.5 });
        if (step.genotype.channels[3]!.recipe !== 'offbeat-rest-bar-4') break;
        expect(rises(step.slot, 3, 64).every((t) => t < 48)).toBe(true);
      }
    }
  });
});
