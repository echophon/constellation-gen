import {
  CHANNEL_COUNT,
  PATTERN_COUNT,
  defaultChannel,
  defaultSaveSlot,
  type Channel,
  type Pattern,
  type SaveSlot,
} from '../format/saveSlot';
import { fitSteps, parseSteps, type FitPattern } from './fitter';
import type { Genre, Layer, PatternSpec, Recipe, Tier, Value } from './genres';
import { int, nextSeed, pick, pickWeighted, rng, type Rng } from './rng';

// Draws a Save Slot from a Genre. The same Genre and seed always give the
// same Save Slot. The Genotype records which Recipe and Layer each Pattern
// came from, so that a later change can redraw one part and keep the rest.

/** The Layers kept for one Channel, in Pattern order. */
export interface ChannelGenes {
  recipe: string;
  /** `layer` indexes the Recipe's layers; `patterns` is how many Patterns it took. */
  layers: { layer: number; patterns: number }[];
}

export interface Genotype {
  genre: string;
  seed: number;
  channels: ChannelGenes[];
}

export interface Generated {
  slot: SaveSlot;
  genotype: Genotype;
}

export const SLOT_COUNT = 20;

function draw(r: Rng, value: Value): number {
  if (typeof value === 'number') return value;
  if ('lo' in value) return int(r, value.lo, value.hi);
  return pick(r, value);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function drawPattern(r: Rng, spec: PatternSpec): Pattern {
  const length = Math.max(1, draw(r, spec.length));
  const events = clamp(draw(r, spec.events ?? 1), 1, length);
  const rotate =
    spec.rotate === 'any' ? int(r, 0, length - 1) : spec.rotate === 'last' ? length - 1 : draw(r, spec.rotate ?? 0) % length;
  return {
    mute: 0,
    chance: clamp(draw(r, spec.chance ?? 100), 0, 100),
    length,
    events,
    rotate,
    // The panel caps Burst at the room between Events.
    burst: clamp(draw(r, spec.burst ?? 1), 1, Math.floor(length / events)),
    ratchet: clamp(draw(r, spec.ratchet ?? 1), 1, 255),
    divide: clamp(draw(r, spec.divide ?? 1), 1, 255),
  };
}

const fits = new Map<string, FitPattern[]>();

/** The Patterns for a step grid under the Recipe's Logic. Throws when the genre data asks for a grid that does not fit. */
function fitGrid(grid: string, recipe: Recipe): FitPattern[] {
  const logic = recipe.logic === 'XOR' ? 'XOR' : 'OR';
  const key = `${logic} ${grid}`;
  let found = fits.get(key);
  if (!found) {
    const fit = fitSteps(parseSteps(grid), { logic });
    if (!fit) throw new Error(`recipe "${recipe.id}": "${grid}" does not fit in ${PATTERN_COUNT} Patterns under ${logic}`);
    fits.set(key, (found = fit.patterns));
  }
  return found;
}

function drawLayer(r: Rng, layer: Layer, recipe: Recipe): Pattern[] {
  const out: Pattern[] = [];
  if (layer.grid) {
    const chance = clamp(draw(r, layer.chance ?? 100), 0, 100);
    for (const p of fitGrid(pick(r, layer.grid), recipe)) out.push({ mute: 0, chance, ...p, ratchet: 1, divide: 1 });
  }
  if (layer.pattern) out.push(drawPattern(r, layer.pattern));
  return out;
}

interface Drawn {
  layer: number;
  tier: Tier;
  patterns: Pattern[];
}

/** Drops ornaments first, last Layer first, until the Channel's Patterns fit. */
function trim(drawn: Drawn[], recipe: Recipe): Drawn[] {
  const kept = [...drawn];
  const count = () => kept.reduce((n, d) => n + d.patterns.length, 0);
  while (count() > PATTERN_COUNT) {
    const tier = Math.max(...kept.map((d) => d.tier));
    if (tier === 0) throw new Error(`recipe "${recipe.id}": its anchors need more than ${PATTERN_COUNT} Patterns`);
    kept.splice(kept.map((d) => d.tier).lastIndexOf(tier as Tier), 1);
  }
  return kept;
}

function drawChannel(r: Rng, recipe: Recipe): { channel: Channel; genes: ChannelGenes } {
  const drawn: Drawn[] = [];
  recipe.layers.forEach((layer, index) => {
    if (layer.odds !== undefined && r() >= layer.odds) return;
    const patterns = drawLayer(r, layer, recipe);
    if (patterns.length) drawn.push({ layer: index, tier: layer.tier, patterns });
  });
  const kept = trim(drawn, recipe);
  const patterns = kept.flatMap((d) => d.patterns);

  const base = defaultChannel();
  const channel: Channel = {
    ...base,
    flop: recipe.flop ? 1 : 0,
    ratchet: recipe.clock?.[0] ?? 1,
    divide: recipe.clock?.[1] ?? 1,
    width: clamp(draw(r, recipe.width ?? 50), 0, 100),
    rotate: clamp(draw(r, recipe.delay ?? 0), 0, 100),
    logic: recipe.logic ?? 'OR',
    patterns: base.patterns.map((p, i) => patterns[i] ?? { ...p, mute: 1 }),
  };
  return { channel, genes: { recipe: recipe.id, layers: kept.map((d) => ({ layer: d.layer, patterns: d.patterns.length })) } };
}

/**
 * One Save Slot in the Genre. `clock` overrides the drawn BPM and swing, for
 * Save Slots that must share a Main Clock.
 */
export function generateSlot(genre: Genre, seed: number, clock?: { bpm: number; swing: number }): Generated {
  if (genre.roles.length !== CHANNEL_COUNT) throw new Error(`genre "${genre.id}" needs ${CHANNEL_COUNT} roles`);
  const r = rng(seed);
  const slot = defaultSaveSlot();
  // Drawn even when overridden, so the Channels do not depend on whether a clock was given.
  const bpm = draw(r, genre.bpm);
  const swing = draw(r, genre.swing);
  slot.clock.bpm = clock?.bpm ?? bpm;
  slot.clock.swing = clock?.swing ?? swing;

  const channels: ChannelGenes[] = [];
  genre.roles.forEach((role, c) => {
    const { channel, genes } = drawChannel(r, pickWeighted(r, role.recipes));
    slot.channels[c] = channel;
    channels.push(genes);
  });
  return { slot, genotype: { genre: genre.id, seed, channels } };
}

export interface GeneratedBank {
  genre: string;
  seed: number;
  slots: Generated[];
}

/**
 * A Bank of Save Slots in the Genre. They share one BPM and swing, and so can
 * be swapped in Live Mode without a Reset.
 */
export function generateBank(genre: Genre, seed: number): GeneratedBank {
  const r = rng(seed);
  const clock = { bpm: draw(r, genre.bpm), swing: draw(r, genre.swing) };
  const slots = Array.from({ length: SLOT_COUNT }, () => generateSlot(genre, nextSeed(r), clock));
  return { genre: genre.id, seed, slots };
}
