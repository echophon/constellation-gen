// Writes a variation of one Save Slot into another slot of the same Bank.
//   npm run evolve -- <bank folder> <from> <into> [--amount 0.3] [--seed 1234] [--anchors]
// Uses the Save Slot's Genotype from BANK.JSN when it has one that still
// matches; otherwise it can only move Patterns and shift Chance.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSaveSlot, serializeSaveSlot } from '../src/engine/index';
import { evolve, evolveBare } from '../src/gen/evolve';
import { genreById } from '../src/gen/genres';
import { SIDECAR_NAME, channelHash, genotypeOf, parseSidecar, serializeSidecar } from '../src/gen/sidecar';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const anchorsAt = args.indexOf('--anchors');
if (anchorsAt >= 0) args.splice(anchorsAt, 1);
const amount = Number(flag('amount') ?? 0.3);
const seedArg = flag('seed');
const seed = seedArg === undefined ? Math.floor(Math.random() * 0x100000000) : Number(seedArg);
const [dir, fromArg, intoArg] = args;
const from = Number(fromArg);
const into = Number(intoArg);
const valid = (n: number) => Number.isInteger(n) && n >= 0 && n < 20;

if (!dir || !valid(from) || !valid(into) || !(amount >= 0 && amount <= 1) || !Number.isInteger(seed)) {
  console.error('usage: npm run evolve -- <bank folder> <from 0-19> <into 0-19> [--amount 0-1] [--seed 1234] [--anchors]');
  process.exit(1);
}

const file = (n: number) => join(dir, `${String(n).padStart(2, '0')}.TXT`);
const sidecarFile = join(dir, SIDECAR_NAME);
const parent = parseSaveSlot(readFileSync(file(from), 'utf8'));
const sidecar = existsSync(sidecarFile) ? parseSidecar(readFileSync(sidecarFile, 'utf8')) : null;
const genotype = sidecar && genotypeOf(sidecar, from, parent);
const genre = genotype && genreById(genotype.genre);
const options = { seed, amount, anchors: anchorsAt >= 0 };

if (genotype && genre) {
  const child = evolve(genre, { slot: parent, genotype }, options);
  writeFileSync(file(into), serializeSaveSlot(child.slot));
  sidecar!.slots[into] = { genotype: child.genotype, hash: channelHash(child.slot) };
  writeFileSync(sidecarFile, serializeSidecar(sidecar!));
  console.log(`${genre.name}: slot ${from} → ${into}, seed ${seed}, distance ${child.distance.toFixed(2)}`);
} else {
  const child = evolveBare(parent, options);
  writeFileSync(file(into), serializeSaveSlot(child.slot));
  if (sidecar) {
    sidecar.slots[into] = null;
    writeFileSync(sidecarFile, serializeSidecar(sidecar));
  }
  console.log(`no Genotype for slot ${from}: slot ${from} → ${into}, seed ${seed}, distance ${child.distance.toFixed(2)}`);
}
