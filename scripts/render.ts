// Prints a text timeline of a Save Slot, one column per Main Clock pulse.
//   npm run render -- 000/00.TXT [pulses]
// "#" a rising edge in that pulse, "=" high throughout, "." low.

import { readFileSync } from 'node:fs';
import { parseSaveSlot, renderSlot } from '../src/engine/index';

const [file, pulsesArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: npm run render -- <save slot file> [pulses]');
  process.exit(1);
}
const pulses = pulsesArg ? parseInt(pulsesArg, 10) : 64;
const slot = parseSaveSlot(readFileSync(file, 'utf8'));

console.log(`${file}  ${slot.clock.bpm} bpm, ${pulses} pulses`);
renderSlot(slot, pulses).forEach((edges, c) => {
  let row = '';
  let level = false;
  let i = 0;
  for (let p = 0; p < pulses; p++) {
    const startLevel = level;
    let rose = false;
    while (i < edges.length && edges[i]!.t < p + 1) {
      level = edges[i]!.high;
      if (level) rose = true;
      i++;
    }
    row += rose ? '#' : startLevel && level ? '=' : '.';
    if (p % 16 === 15) row += ' ';
  }
  const ch = slot.channels[c]!;
  console.log(`${'I II III IV V VI VII VIII'.split(' ')[c]!.padStart(4)} ${row} ${ch.logic}${ch.mute ? ' muted' : ''}`);
});
