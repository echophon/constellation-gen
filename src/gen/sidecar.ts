import { serializeSaveSlot, type SaveSlot } from '../format/saveSlot';
import type { GeneratedBank } from './bank';
import type { Genotype } from './generate';

// The sidecar is one file in a Bank's folder, beside its Save Slots. It keeps
// each generated Save Slot's Genotype, which the Save Slot format has no room
// for. See research/genre-patterns.md.

export const SIDECAR_NAME = 'BANK.JSN';

export interface SidecarSlot {
  genotype: Genotype;
  /** `channelHash` of the Save Slot as generated. */
  hash: string;
}

export interface Sidecar {
  version: 1;
  genre: string;
  seed: number;
  /** One per Save Slot; null for a Save Slot that was not generated. */
  slots: (SidecarSlot | null)[];
}

/**
 * A hash of a Save Slot's Channel and Pattern lines. The clock and CV lines
 * are left out: the module rewrites them depending on how a Save Slot is saved.
 */
export function channelHash(slot: SaveSlot): string {
  const lines = serializeSaveSlot(slot).split('\n').filter((l) => l.startsWith('C'));
  // FNV-1a
  let h = 0x811c9dc5;
  for (const ch of lines.join('\n')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function sidecarFor(bank: GeneratedBank): Sidecar {
  return {
    version: 1,
    genre: bank.genre,
    seed: bank.seed,
    slots: bank.slots.map(({ slot, genotype }) => ({ genotype, hash: channelHash(slot) })),
  };
}

export function serializeSidecar(sidecar: Sidecar): string {
  // One Save Slot per line, so the file stays small and diffs stay readable.
  const { slots, ...head } = sidecar;
  const lines = slots.map((s) => `  ${JSON.stringify(s)}`).join(',\n');
  return `${JSON.stringify(head).slice(0, -1)},"slots":[\n${lines}\n]}\n`;
}

export function parseSidecar(text: string): Sidecar {
  const data = JSON.parse(text) as Partial<Sidecar>;
  if (data.version !== 1 || !Array.isArray(data.slots)) throw new Error('not a version 1 Bank sidecar');
  return data as Sidecar;
}

/**
 * The Genotype of a Save Slot, or null when it has none or when its Channels
 * have been edited since it was generated.
 */
export function genotypeOf(sidecar: Sidecar, index: number, slot: SaveSlot): Genotype | null {
  const entry = sidecar.slots[index];
  return entry && entry.hash === channelHash(slot) ? entry.genotype : null;
}
