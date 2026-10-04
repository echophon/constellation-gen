// Prints the fewest Patterns that play a step grid, as Save Slot lines.
//   npm run fit -- "x..x..x...x.x..." [any|OR|XOR]

import { fitSteps, parseSteps, withFit } from '../src/gen/fitter';
import { defaultChannel } from '../src/engine/index';

const [grid, logic = 'any'] = process.argv.slice(2);
if (!grid || !['OR', 'XOR', 'any'].includes(logic)) {
  console.error('usage: npm run fit -- "<x and . steps>" [any|OR|XOR]');
  process.exit(1);
}
const fit = fitSteps(parseSteps(grid), { logic: logic as 'OR' | 'XOR' | 'any' });
if (!fit) {
  console.error('no fit within 8 Patterns');
  process.exit(1);
}

const ch = withFit(defaultChannel(), fit);
console.log(`C0 = ${[ch.mute, ch.flop, ch.ratchet, ch.divide, ch.width, ch.rotate, ch.logic].join(',')}`);
fit.patterns.forEach((_, j) => {
  const p = ch.patterns[j]!;
  console.log(`C0.P${j} = ${[p.mute, p.chance, p.length, p.events, p.rotate, p.burst, p.ratchet, p.divide].join(',')}`);
});
