// Evidence for research/genre-patterns.md: renders candidate genre encodings
// through the engine and searches for the fewest Patterns per target grid.
//   npx tsx research/genre-patterns-spike.ts
// Throwaway; the engine it calls is itself unverified against hardware
// (src/engine/ASSUMPTIONS.md).

import {
  defaultSaveSlot, renderSlot, euclid, patternSteps,
  type Pattern, type Channel, type SaveSlot,
} from '../src/engine/index';

type P = Partial<Pattern>;
const pat = (o: P): Pattern => ({ mute: 0, chance: 100, length: 16, events: 1, rotate: 0, burst: 1, ratchet: 1, divide: 1, ...o });
function slotOf(patterns: P[], ch: Partial<Channel> = {}): SaveSlot {
  const s = defaultSaveSlot();
  const c = s.channels[0]!;
  Object.assign(c, ch);
  c.patterns = c.patterns.map((p, i) => (patterns[i] ? pat(patterns[i]!) : { ...p, mute: 1 }));
  return s;
}
const rises = (s: SaveSlot, to: number) => renderSlot(s, to)[0]!.filter((e) => e.high).map((e) => +e.t.toFixed(3));
/** x/. per Main Clock pulse (16th), '?' if a rise is off-grid. */
function grid(s: SaveSlot, to: number): string {
  const g = new Array<string>(to).fill('.');
  for (const t of rises(s, to)) g[Math.floor(t)] = Number.isInteger(t) ? 'x' : '?';
  return g.join('').replace(/(.{16})/g, '$1 ').trim();
}
const show = (name: string, patterns: P[], ch: Partial<Channel> = {}, to = 16) =>
  console.log(name.padEnd(34), grid(slotOf(patterns, ch), to));
const one = (...steps: number[]) => steps.map((r) => ({ rotate: r }));

console.log('== 1. single-pattern genre atoms');
show('four on floor E(1,4)', [{ length: 4 }]);
show('backbeat E(1,8) r4', [{ length: 8, rotate: 4 }]);
show('offbeat hat E(1,4) r2', [{ length: 4, rotate: 2 }]);
show('8th hats E(1,2)', [{ length: 2 }]);
show('half-time snare E(1,16) r8', [{ rotate: 8 }]);
show('tresillo E(3,8)', [{ length: 8, events: 3 }]);
show('drill hats E(3,8) (=1,4,7,9,12,15)', [{ length: 8, events: 3 }]);

console.log('== 2. OR of one-hots / small euclids');
show('dnb 2-step kick 0,10', one(0, 10));
show('jersey kick: {0,1} XOR E(5,16) r8', [{ burst: 2 }, { events: 5, rotate: 8 }], { logic: 'XOR' });
show('son clave: {9,10} XOR E(5,16)', [{ rotate: 9, burst: 2 }, { events: 5 }], { logic: 'XOR' });
show('son clave 3-2', one(0, 3, 6, 10, 12));
show('rumba clave 3-2', one(0, 3, 7, 10, 12));
show('amen snare b1 4,7,9,12,15', [{ length: 8, rotate: 4 }, { rotate: 7 }, { rotate: 9 }, { rotate: 15 }]);
show('amen kick b1 0,2,10,11', [{ rotate: 0, burst: 1 }, { rotate: 2 }, { rotate: 10, burst: 2 }]);

console.log('== 3. XOR as subtraction');
show('dembow snare: E(3,8) XOR E(1,8)', [{ length: 8, events: 3 }, { length: 8 }], { logic: 'XOR' });
show('16ths minus downbeats', [{ length: 1, events: 1 }, { length: 4 }], { logic: 'XOR' });
show('2-bar: kick, no downbeat bar 2', [{ length: 16 }, { rotate: 10 }, { length: 32, rotate: 16 }], { logic: 'XOR' }, 32);
show('drill snare 8, 28 (len 32)', [{ length: 32, rotate: 8 }, { length: 32, rotate: 28 }], {}, 32);
show('drill snare via XOR', [{ length: 16, rotate: 8 }, { length: 32, rotate: 24 }, { length: 32, rotate: 28 }], { logic: 'XOR' }, 32);

console.log('== 4. amen 4 bars');
const L64 = (r: number): P => ({ length: 64, rotate: r });
show('amen kick XOR (7 Patterns)', [{ rotate: 2 }, { rotate: 10 }, { rotate: 0 }, L64(48), L64(11), L64(27), L64(51)], { logic: 'XOR' }, 64);
show('amen kick OR (8 Patterns)', [{ rotate: 2 }, { rotate: 10 }, L64(0), L64(16), L64(32), L64(11), L64(27), L64(51)], {}, 64);
console.log('  want'.padEnd(34), 'x.x.......xx.... x.x.......xx.... x.x.......x..... ..xx......x.....');
show('amen snare, main hits', [{ rotate: 4 }, L64(12), L64(28), L64(46), L64(62)], {}, 64);
console.log('  want'.padEnd(34), '....x.......x... ....x.......x... ....x.........x. ....x.........x.');
show('amen snare, ghost hits', [{ rotate: 7 }, { rotate: 9 }, L64(15), L64(31), L64(49)], {}, 64);
console.log('  want'.padEnd(34), '.......x.x.....x .......x.x.....x .......x.x...... .x.....x.x......');
show('OR with a slow Pattern swallows hits', [{ length: 2 }, { length: 2, divide: 8 }], {}, 32);
show('  same at width 10', [{ length: 2 }, { length: 2, divide: 8 }], { width: 10 }, 32);

console.log('== 5. AND mask: 16th roll only at end of bar 4, by width');
for (const width of [50, 75, 90]) {
  show(`  16ths AND (div8,len8,r7) w${width}`, [{ length: 1 }, { length: 8, rotate: 7, divide: 8 }], { logic: 'AND', width }, 64);
}
show('  16ths AND (div4,len16,r14,burst2) w90', [{ length: 1 }, { length: 16, rotate: 14, burst: 2, divide: 4 }], { logic: 'AND', width: 90 }, 64);
console.log('  rises w90:', rises(slotOf([{ length: 1 }, { length: 8, rotate: 7, divide: 8 }], { logic: 'AND', width: 90 }), 64).join(' '));

console.log('== 6. flop');
show('flop E(3,8): odd events invert per loop', [{ length: 8, events: 3 }], { flop: 1 }, 32);
console.log('  edges:', renderSlot(slotOf([{ length: 8, events: 3 }], { flop: 1 }), 32)[0]!.map((e) => `${e.t}${e.high ? '^' : 'v'}`).join(' '));
console.log('  808 gate E(2,16)r0 + r6 flop:', renderSlot(slotOf(one(0, 6), { flop: 1 }), 32)[0]!.map((e) => `${e.t}${e.high ? '^' : 'v'}`).join(' '));

console.log('== 7. ratchet / tuplets (rise times in 16ths)');
console.log('  hat roll div2 len8 r7 ratchet3:', rises(slotOf([{ length: 8, rotate: 7, divide: 2, ratchet: 3 }]), 16).join(' '));
console.log('  hat roll len16 r15 ratchet2 (32nds):', rises(slotOf([{ rotate: 15, ratchet: 2 }]), 16).join(' '));
console.log('  12/8 bell: ch 3:4, E(7,12):', rises(slotOf([{ length: 12, events: 7 }], { ratchet: 3, divide: 4 }), 16).join(' '));
console.log('  footwork 32nd kick pairs: ch x2, len 8 burst 2:', rises(slotOf([{ length: 8, burst: 2 }], { ratchet: 2 }), 16).join(' '));
console.log('  quintuplet ch 5:4 E(1,1):', rises(slotOf([{ length: 1 }], { ratchet: 5, divide: 4 }), 8).join(' '));

console.log('== 8. polymeter');
show('E(3,8) OR E(1,5)', [{ length: 8, events: 3 }, { length: 5 }], {}, 64);
show('E(5,16) XOR E(2,7)', [{ length: 16, events: 5 }, { length: 7, events: 2 }], { logic: 'XOR' }, 64);

console.log('== 9. Toussaint: engine euclid vs paper, and rotate for the named start');
const draw = (b: boolean[]) => b.map((x) => (x ? 'x' : '.')).join('');
const named: [string, number, number, string][] = [
  ['tresillo', 3, 8, 'x..x..x.'], ['cinquillo', 5, 8, 'x.xx.xx.'], ['cumbia/calypso', 3, 4, 'x.xx'],
  ['khafif-e-ramal', 2, 5, 'x.x..'], ['take five', 2, 5, 'x..x.'], ['ruchenitza', 3, 7, 'x.x.x..'],
  ['ruchenitza 2', 4, 7, 'x.x.x.x'], ['aksak', 4, 9, 'x.x.x.x..'], ['zappa', 4, 11, 'x..x..x..x.'],
  ['york-samai', 5, 6, 'xxxxx.'], ['nawakhat', 5, 7, 'x.xx.xx'], ['agsag-samai', 5, 9, 'x.x.x.x.x'],
  ['pictures', 5, 11, 'x.x.x.x.x..'], ['venda clap', 5, 12, 'x..x.x..x.x.'],
  ['bossa nova', 5, 16, 'x..x..x...x..x..'], ['bossa alt', 5, 16, 'x..x..x..x...x..'],
  ['tuareg bendir', 7, 8, 'x.xxxxxx'], ['w.african bell', 7, 12, 'x.xx.x.xx.x.'], ['bembe', 7, 12, 'x.x.xx.x.x.x'],
  ['samba', 7, 16, 'x.x..x.x.x..x.x.'], ['samba necklace', 7, 16, 'x..x.x.x..x.x.x.'],
  ['CAR necklace', 9, 16, 'x.xx.x.x.xx.x.x.'], ['fandango', 4, 12, 'x..x..x..x..'], ['tumbao conga', 2, 3, 'x.x'],
  ['aka 11/24', 11, 24, 'x..x.x.x.x.x..x.x.x.x.x.'], ['aka 13/24', 13, 24, 'x.xx.x.x.x.x.xx.x.x.x.x.'],
];
for (const [name, k, n, want] of named) {
  const rots: number[] = [];
  for (let r = 0; r < n; r++) if (draw(patternSteps({ length: n, events: k, rotate: r, burst: 1 })) === want) rots.push(r);
  console.log(`  ${name.padEnd(16)} E(${k},${n}) engine=${draw(euclid(n, k)).padEnd(24)} want=${want.padEnd(24)} rotate=${rots.length ? rots.join('|') : 'NOT A ROTATION'}`);
}

console.log('== 10. fitter: fewest Patterns (divide 1, lengths dividing the loop) per target');
function candidates(loop: number) {
  const seen = new Map<number, string>();
  for (let L = 1; L <= loop; L++) {
    if (loop % L) continue;
    for (let e = 1; e <= L; e++) for (let r = 0; r < L; r++) for (let b = 1; b <= Math.max(1, Math.floor(L / e)); b++) {
      const st = patternSteps({ length: L, events: e, rotate: r, burst: b });
      let m = 0;
      for (let i = 0; i < loop; i++) if (st[i % L]) m |= 1 << i;
      m >>>= 0;
      const label = `(${L},${e},r${r}${b > 1 ? `,b${b}` : ''})`;
      const old = seen.get(m);
      if (!old || label.length < old.length) seen.set(m, label);
    }
  }
  return seen;
}
const maskOf = (s: string) => [...s.replace(/ /g, '')].reduce((m, c, i) => (c === 'x' ? (m | (1 << i)) >>> 0 : m), 0);
function fit(target: string) {
  const loop = target.replace(/ /g, '').length;
  const T = maskOf(target);
  const C = candidates(loop);
  const res: Record<string, string> = {};
  // OR: only subsets of T
  const sub = [...C].filter(([m]) => (m & ~T) === 0);
  let best: string[] | null = null;
  const dfs = (i: number, acc: number, used: string[]) => {
    if (best && used.length >= best.length) return;
    if (acc === T) { best = [...used]; return; }
    if (i >= sub.length || used.length >= 6) return;
    for (let j = i; j < sub.length; j++) {
      const [m, l] = sub[j]!;
      if ((m & ~acc) === 0) continue;
      used.push(l); dfs(j + 1, (acc | m) >>> 0, used); used.pop();
    }
  };
  sub.sort((a, b) => popcnt(b[0]) - popcnt(a[0]));
  dfs(0, 0, []);
  res.or = best ? (best as string[]).join(' ') : '>6';
  // XOR: up to 4 via meet in the middle
  const arr = [...C];
  let x: string | null = C.has(T) ? C.get(T)! : null;
  if (!x) for (const [m, l] of arr) { const o = C.get((T ^ m) >>> 0); if (o) { x = `${l} ${o}`; break; } }
  if (!x) {
    outer: for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const o = C.get((T ^ arr[i]![0] ^ arr[j]![0]) >>> 0);
      if (o) { x = `${arr[i]![1]} ${arr[j]![1]} ${o}`; break outer; }
    }
  }
  res.xor = x ?? '>3';
  return res;
}
function popcnt(m: number) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
const targets: [string, string][] = [
  ['dnb 2-step kick', 'x.........x.....'], ['amen kick b1', 'x.x.......xx....'], ['amen snare b1', '....x..x.x..x..x'],
  ['jersey kick', 'x...x...x..x..x.'], ['son clave 3-2', 'x..x..x...x.x...'], ['rumba clave 3-2', 'x..x...x..x.x...'],
  ['son clave 2-3', '..x.x...x..x..x.'], ['dembow snare', '...x..x....x..x.'], ['boom bap kick A', 'x......x..x.....'],
  ['boom bap kick B', 'x..x....x.x.....'], ['garage kick', 'x.........x..x..'], ['baile funk', 'x..x..x...x.x...'],
  ['electro kick', 'x.....x...x.....'], ['drill snare 2bar', '........x....... ............x...'],
  ['trap hat gap', 'x.x.x.x.x.x.xxxx'],
  ['16ths minus 1 hit', 'xxxxxxxxxxxxxx.x'], ['gahu bell', 'x..x..x...x...x.'], ['soukous', 'x..x..x...xx....'],
  ['shiko', 'x...x.x...x.x...'],
];
for (const [n, t] of targets) { const r = fit(t); console.log(`  ${n.padEnd(18)} ${t.padEnd(34)} OR: ${r.or!.padEnd(44)} XOR: ${r.xor}`); }
