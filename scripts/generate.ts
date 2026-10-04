// Writes a Bank of Save Slots in a genre, with its sidecar.
//   npm run generate -- --list
//   npm run generate -- <genre> [--bank 001] [--seed 1234] [--out banks] [--force]
// The Bank is written to <out>/<bank>/00.TXT … 19.TXT and BANK.JSN.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeSaveSlot } from '../src/engine/index';
import { generateBank } from '../src/gen/generate';
import { GENRES, genreById } from '../src/gen/genres';
import { SIDECAR_NAME, serializeSidecar, sidecarFor } from '../src/gen/sidecar';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const has = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

if (has('list')) {
  for (const g of GENRES) console.log(`${g.id.padEnd(12)} ${g.name}, ${g.bpm.lo}–${g.bpm.hi} bpm`);
  process.exit(0);
}
const force = has('force');
const bank = (flag('bank') ?? '001').padStart(3, '0');
const out = flag('out') ?? 'banks';
const seedArg = flag('seed');
const seed = seedArg === undefined ? Math.floor(Math.random() * 0x100000000) : Number(seedArg);
const genre = genreById(args[0] ?? '');

if (!genre || !/^\d{3}$/.test(bank) || !Number.isInteger(seed) || seed < 0) {
  console.error('usage: npm run generate -- <genre> [--bank 001] [--seed 1234] [--out banks] [--force]');
  console.error(`genres: ${GENRES.map((g) => g.id).join(', ')}`);
  process.exit(1);
}

const dir = join(out, bank);
if (existsSync(dir) && !force) {
  console.error(`${dir} already exists; pass --force to overwrite its Save Slots`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const generated = generateBank(genre, seed);
generated.slots.forEach(({ slot }, i) => {
  writeFileSync(join(dir, `${String(i).padStart(2, '0')}.TXT`), serializeSaveSlot(slot));
});
writeFileSync(join(dir, SIDECAR_NAME), serializeSidecar(sidecarFor(generated)));

const { bpm, swing } = generated.slots[0]!.slot.clock;
console.log(`${genre.name}, seed ${seed}: ${generated.slots.length} Save Slots in ${dir}, ${bpm} bpm, swing ${swing}`);
