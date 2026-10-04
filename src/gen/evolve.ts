import { renderSlot } from '../engine/engine';
import { CHANNEL_COUNT, type Channel, type Pattern, type SaveSlot } from '../format/saveSlot';
import {
  blocksOf,
  buildChannel,
  clamp,
  draw,
  drawBlock,
  drawChannel,
  type Block,
  type ChannelFeel,
  type Generated,
  type Genotype,
} from './generate';
import type { Genre, Recipe, Tier } from './genres';
import { int, nextSeed, pick, pickWeighted, rng, type Rng } from './rng';

// Evolve changes some aspects of a Save Slot and keeps the rest. It applies a
// few operators, each scoped to one Layer or one Pattern, then renders the
// result and keeps it only if it can be heard and is not too far from its
// parent. See research/genre-patterns.md, section 5.

export interface EvolveOptions {
  seed: number;
  /** 0 changes little (ornaments, feel); 1 rerolls motifs and whole Roles. Default 0.3. */
  amount?: number;
  /** Channels to leave alone, by index. */
  locked?: readonly boolean[];
  /** Let anchors change too. Default false: the genre's defining hits stay. */
  anchors?: boolean;
}

export interface Evolved extends Generated {
  /** How far the result is from its parent, 0 to 1. */
  distance: number;
}

const ATTEMPTS = 24;
/** Pulses rendered to compare two Save Slots: four bars. */
const SPAN = 64;
/** Kick and snare count for more than the rest. */
const WEIGHTS = [3, 3, 1, 1, 1, 1, 1, 1];

/** The most a result may differ from its parent, for an amount. */
const budget = (amount: number) => 0.08 + 0.5 * amount;

/** When each Channel rises over four bars with every Chance at 100, to a 24th of a pulse. */
function rises(slot: SaveSlot): Set<number>[] {
  const certain: SaveSlot = {
    ...slot,
    channels: slot.channels.map((ch) => ({ ...ch, patterns: ch.patterns.map((p) => ({ ...p, chance: 100 })) })),
  };
  return renderSlot(certain, SPAN).map((edges) => new Set(edges.filter((e) => e.high).map((e) => Math.round(e.t * 24))));
}

/**
 * How differently two Save Slots play, 0 (the same Events) to 1 (none shared):
 * the Events only one of them has, over the Events either has.
 */
export function distance(a: SaveSlot, b: SaveSlot): number {
  const ra = rises(a);
  const rb = rises(b);
  let differ = 0;
  let total = 0;
  for (let c = 0; c < CHANNEL_COUNT; c++) {
    const union = new Set([...ra[c]!, ...rb[c]!]);
    let shared = 0;
    for (const t of ra[c]!) if (rb[c]!.has(t)) shared++;
    differ += WEIGHTS[c]! * (union.size - shared);
    total += WEIGHTS[c]! * union.size;
  }
  return total ? differ / total : 0;
}

/** What `distance` does not see: Chance, Width, delay and Flop. */
const feelOf = (slot: SaveSlot) =>
  JSON.stringify(slot.channels.map((ch) => [ch.width, ch.rotate, ch.flop, ch.mute, ch.patterns.filter((p) => !p.mute).map((p) => p.chance)]));

// ---------- operators on Patterns ----------

/** Moves the Pattern a step, or adds or removes one Event. False when it has no room to change. */
function nudge(r: Rng, p: Pattern): boolean {
  if (p.length < 2) return false;
  if (r() < 0.6 || p.length < 3) {
    p.rotate = (p.rotate + pick(r, [1, p.length - 1])) % p.length;
  } else {
    const events = clamp(p.events + pick(r, [-1, 1]), 1, p.length - 1);
    if (events === p.events) return false;
    p.events = events;
    p.burst = clamp(p.burst, 1, Math.floor(p.length / events));
  }
  return true;
}

/** Makes a Pattern that sometimes plays do so more or less often. */
function shiftChance(r: Rng, p: Pattern): boolean {
  if (p.chance >= 100) return false;
  const chance = clamp(p.chance + pick(r, [-1, 1]) * int(r, 10, 20), 10, 95);
  if (chance === p.chance) return false;
  p.chance = chance;
  return true;
}

function nudgeWidth(r: Rng, feel: ChannelFeel): boolean {
  const width = clamp(feel.width + pick(r, [-1, 1]) * int(r, 5, 15), 20, 85);
  if (width === feel.width) return false;
  feel.width = width;
  return true;
}

// ---------- with a Genotype ----------

/** One Channel while it is being changed. */
interface Working {
  recipe: Recipe;
  blocks: Block[];
  feel: ChannelFeel;
  /** Set when the whole Channel was redrawn. */
  redrawn?: { channel: Channel; genes: Genotype['channels'][number] };
}

type Operator = (r: Rng, w: Working, role: Genre['roles'][number], options: EvolveOptions) => boolean;

const copyPattern = (p: Pattern): Pattern => ({ ...p });
const layersOf = (w: Working, tier: Tier) => w.recipe.layers.flatMap((l, i) => (l.tier === tier ? [i] : []));

/** Redraws one Layer of a tier, adds it if it was left out, or drops it if it is optional. */
function rerollLayer(r: Rng, w: Working, tier: Tier): boolean {
  const candidates = layersOf(w, tier);
  if (!candidates.length) return false;
  const layer = pick(r, candidates);
  const at = w.blocks.findIndex((b) => b.layer === layer);
  if (at >= 0 && w.recipe.layers[layer]!.odds !== undefined && r() < 0.3) {
    w.blocks.splice(at, 1);
    return true;
  }
  const block = drawBlock(r, w.recipe, layer);
  if (!block) return false;
  if (at >= 0) w.blocks[at] = block;
  else w.blocks.push(block);
  return true;
}

/** A Pattern of one of the given tiers. Channels under AND are left out: their Patterns only work together. */
function patternIn(r: Rng, w: Working, tiers: Tier[]): Pattern | null {
  if (w.recipe.logic === 'AND') return null;
  const patterns = w.blocks.filter((b) => tiers.includes(b.tier)).flatMap((b) => b.patterns);
  return patterns.length ? pick(r, patterns) : null;
}

const OPERATORS: Record<string, Operator> = {
  chance: (r, w) => {
    const p = patternIn(r, w, [2]);
    return p ? shiftChance(r, p) : false;
  },
  feel: (r, w) => {
    const before = JSON.stringify(w.feel);
    if (typeof w.recipe.width === 'object') w.feel.width = clamp(draw(r, w.recipe.width), 0, 100);
    if (typeof w.recipe.delay === 'object') w.feel.delay = clamp(draw(r, w.recipe.delay), 0, 100);
    if (JSON.stringify(w.feel) !== before) return true;
    // Flop and AND Channels depend on their Width.
    return w.recipe.flop || w.recipe.logic === 'AND' || !w.blocks.length ? false : nudgeWidth(r, w.feel);
  },
  ornament: (r, w) => rerollLayer(r, w, 2),
  nudge: (r, w) => {
    const p = patternIn(r, w, [1, 2]);
    return p ? nudge(r, p) : false;
  },
  motif: (r, w) => rerollLayer(r, w, 1),
  role: (r, w, role, options) => {
    // A Role with anchors keeps its Recipe unless anchors are unlocked.
    if (!options.anchors && layersOf(w, 0).length) return false;
    const others = role.recipes.filter((x) => x.id !== w.recipe.id);
    const recipe = others.length ? pickWeighted(r, others) : w.recipe;
    w.redrawn = drawChannel(r, recipe);
    return true;
  },
  anchor: (r, w, _role, options) => (options.anchors ? rerollLayer(r, w, 0) : false),
};

/** How likely each operator is, for an amount: small changes at the low end, rerolls at the high end. */
function operatorWeights(amount: number, anchors: boolean) {
  return [
    { op: 'chance', weight: 0.5 + 3 * (1 - amount) },
    { op: 'feel', weight: 0.5 + 2 * (1 - amount) },
    { op: 'ornament', weight: 3 },
    { op: 'nudge', weight: 1 + 2 * amount },
    { op: 'motif', weight: amount > 0.25 ? 4 * amount : 0 },
    { op: 'role', weight: amount > 0.6 ? 3 * (amount - 0.4) : 0 },
    { op: 'anchor', weight: anchors ? amount : 0 },
  ].filter((o) => o.weight > 0);
}

const operatorCount = (amount: number) => 1 + Math.round(amount * 5);

function mutate(r: Rng, genre: Genre, parent: Generated, options: EvolveOptions, amount: number): Generated {
  const working: Working[] = parent.slot.channels.map((channel, c) => {
    const genes = parent.genotype.channels[c]!;
    const recipe = genre.roles[c]!.recipes.find((x) => x.id === genes.recipe)!;
    const blocks = blocksOf(channel, genes, recipe).map((b) => ({ ...b, patterns: b.patterns.map(copyPattern) }));
    return { recipe, blocks, feel: { width: channel.width, delay: channel.rotate } };
  });
  const open = working.flatMap((_, c) => (options.locked?.[c] ? [] : [c]));
  const weights = operatorWeights(amount, options.anchors ?? false);

  let applied = 0;
  for (let tries = 0; open.length && applied < operatorCount(amount) && tries < 60; tries++) {
    const c = pick(r, open);
    const w = working[c]!;
    if (w.redrawn) continue;
    if (OPERATORS[pickWeighted(r, weights).op]!(r, w, genre.roles[c]!, options)) applied++;
  }

  const slot: SaveSlot = { ...parent.slot, clock: { ...parent.slot.clock }, channels: [] };
  const channels: Genotype['channels'] = [];
  working.forEach((w, c) => {
    const built = w.redrawn ?? buildChannel(w.recipe, w.blocks, w.feel);
    // Channel Mute is the player's, not the Recipe's.
    slot.channels.push({ ...built.channel, mute: parent.slot.channels[c]!.mute });
    channels.push(built.genes);
  });
  return { slot, genotype: { ...parent.genotype, generation: parent.genotype.generation + 1, channels } };
}

/** Whether a Genotype still describes a Save Slot generated from this Genre. */
function describes(genre: Genre, parent: Generated): boolean {
  return (
    parent.genotype.genre === genre.id &&
    parent.genotype.channels.length === CHANNEL_COUNT &&
    parent.genotype.channels.every((genes, c) => {
      const recipe = genre.roles[c]!.recipes.find((x) => x.id === genes.recipe);
      const owned = genes.layers.reduce((n, l) => n + l.patterns, 0);
      return !!recipe && genes.layers.every((l) => recipe.layers[l.layer]) && owned <= parent.slot.channels[c]!.patterns.length;
    })
  );
}

/** Tries candidates until one can be heard and is within the budget; otherwise the nearest that can be heard. */
function search<T extends { slot: SaveSlot }>(parent: SaveSlot, options: EvolveOptions, candidate: (r: Rng, amount: number) => T): { best: T | null; distance: number } {
  const amount = clamp(options.amount ?? 0.3, 0, 1);
  const seeds = rng(options.seed);
  const feel = feelOf(parent);
  let best: T | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < ATTEMPTS; i++) {
    const made = candidate(rng(nextSeed(seeds)), amount);
    const d = distance(parent, made.slot);
    if (d === 0 && feelOf(made.slot) === feel) continue;
    if (d <= budget(amount)) return { best: made, distance: d };
    if (d < bestDistance) {
      best = made;
      bestDistance = d;
    }
  }
  return { best, distance: best ? bestDistance : 0 };
}

/**
 * A variation of a generated Save Slot. The parent is not changed. When
 * nothing could be changed (every Channel locked, say) the result is the
 * parent again, at distance 0.
 */
export function evolve(genre: Genre, parent: Generated, options: EvolveOptions): Evolved {
  if (!describes(genre, parent)) throw new Error(`the Genotype does not describe a ${genre.name} Save Slot`);
  const { best, distance: d } = search(parent.slot, options, (r, amount) => mutate(r, genre, parent, options, amount));
  return { ...(best ?? parent), distance: d };
}

// ---------- without a Genotype ----------

function mutateBare(r: Rng, parent: SaveSlot, options: EvolveOptions, amount: number): { slot: SaveSlot } {
  const slot: SaveSlot = {
    ...parent,
    channels: parent.channels.map((ch) => ({ ...ch, patterns: ch.patterns.map(copyPattern) })),
  };
  // Without a Genotype, kick and snare stand in for the anchors.
  const open = slot.channels.flatMap((ch, c) => (options.locked?.[c] || ch.logic === 'AND' || (c < 2 && !options.anchors) ? [] : [c]));
  let applied = 0;
  for (let tries = 0; open.length && applied < operatorCount(amount) && tries < 60; tries++) {
    const ch = slot.channels[pick(r, open)]!;
    const playing = ch.patterns.filter((p) => !p.mute);
    if (!playing.length) continue;
    const p = pick(r, playing);
    if ((p.chance < 100 && r() < 0.5 ? shiftChance(r, p) : nudge(r, p))) applied++;
  }
  return { slot };
}

/**
 * A variation of a Save Slot that has no Genotype, such as one edited on the
 * module. It can only move Patterns, change their Events and shift Chance.
 */
export function evolveBare(parent: SaveSlot, options: EvolveOptions): { slot: SaveSlot; distance: number } {
  const { best, distance: d } = search(parent, options, (r, amount) => mutateBare(r, parent, options, amount));
  return { slot: best?.slot ?? parent, distance: d };
}
