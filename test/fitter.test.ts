import { describe, expect, it } from 'vitest';
import { defaultSaveSlot, renderSlot } from '../src/engine/index';
import { fitSteps, parseSteps, withFit, type Fit, type FitOptions } from '../src/gen/fitter';

const draw = (steps: boolean[]) => steps.map((s) => (s ? 'x' : '.')).join('');

/** What Channel I plays with the fit applied, over two loops, one character per Main Clock pulse. */
function played(fit: Fit, loop: number): string {
  const slot = defaultSaveSlot();
  slot.channels[0] = withFit(slot.channels[0]!, fit);
  const out = new Array<boolean>(loop * 2).fill(false);
  for (const e of renderSlot(slot, loop * 2)[0]!) {
    if (!e.high) continue;
    expect(Number.isInteger(e.t)).toBe(true);
    out[e.t] = true;
  }
  return draw(out);
}

function fitted(grid: string, options?: FitOptions): Fit {
  const steps = parseSteps(grid);
  const fit = fitSteps(steps, options);
  expect(fit, grid).not.toBeNull();
  expect(played(fit!, steps.length), grid).toBe(draw(steps).repeat(2));
  return fit!;
}

describe('parseSteps', () => {
  it('reads Events and rests, ignoring spacing and bar lines', () => {
    expect(draw(parseSteps('x..x | X-.. '))).toBe('x..xx...');
  });

  it('rejects anything else', () => {
    expect(() => parseSteps('x.o.')).toThrow('"o" is not a step');
  });
});

describe('fitSteps', () => {
  it('finds a euclidean rhythm as one Pattern', () => {
    expect(fitted('x..x..x.').patterns).toEqual([{ length: 8, events: 3, rotate: 0, burst: 1 }]);
    expect(fitted('x..x..x...x..x..').patterns).toEqual([{ length: 16, events: 5, rotate: 10, burst: 1 }]);
  });

  it('uses the shortest Length that repeats', () => {
    expect(fitted('x...x...x...x...').patterns).toEqual([{ length: 4, events: 1, rotate: 0, burst: 1 }]);
    expect(fitted('....x.......x...').patterns).toEqual([{ length: 8, events: 1, rotate: 4, burst: 1 }]);
  });

  it('fits genre grids under OR with no more Patterns than the research found', () => {
    const cases: [string, number][] = [
      ['x.........x.....', 2], // two-step kick
      ['x.x.......xx....', 3], // amen kick
      ['....x..x.x..x..x', 3], // amen snare
      ['x...x...x..x..x.', 4], // jersey club kick
      ['x..x..x...x.x...', 5], // son clave
      ['...x..x....x..x.', 2], // dembow snare
      ['x.x.x.x.x.x.xxxx', 2], // hats with a roll
      ['........x....... ............x...', 2], // drill snare, two bars
    ];
    for (const [grid, count] of cases) {
      const fit = fitted(grid, { logic: 'OR' });
      expect(fit.logic).toBe('OR');
      expect(fit.patterns, grid).toHaveLength(count);
    }
  });

  it('fits the claves as a nudged E(5,16) under XOR', () => {
    for (const grid of ['x..x..x...x.x...', 'x..x...x..x.x...', 'x...x...x..x..x.']) {
      const fit = fitted(grid, { logic: 'XOR' });
      expect(fit.logic).toBe('XOR');
      expect(fit.patterns, grid).toHaveLength(2);
    }
  });

  it('by default takes the smaller fit and prefers OR on a tie', () => {
    expect(fitted('x..x..x...x.x...').logic).toBe('XOR');
    expect(fitted('x.........x.....').logic).toBe('OR');
  });

  it('fits a four-bar phrase', () => {
    const kick = 'x.x.......xx.... x.x.......xx.... x.x.......x..... ..xx......x.....';
    expect(fitted(kick, { logic: 'OR' }).patterns.length).toBeLessThanOrEqual(8);
  });

  it('fits step counts other than a power of two', () => {
    expect(fitted('x.x.xx.x.x.x').patterns).toEqual([{ length: 12, events: 7, rotate: 9, burst: 1 }]);
    expect(fitted('x..x.').patterns).toHaveLength(1);
  });

  it('fits any grid of up to 8 Events', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    for (let n = 0; n < 40; n++) {
      const steps = new Array<boolean>(16).fill(false);
      const events = 1 + Math.floor(random() * 8);
      while (steps.filter(Boolean).length < events) steps[Math.floor(random() * 16)] = true;
      fitted(draw(steps));
    }
  });

  it('gives no Patterns for no Events', () => {
    const fit = fitted('........');
    expect(fit.patterns).toEqual([]);
  });

  it('returns null when it cannot fit within maxPatterns', () => {
    expect(fitSteps(parseSteps('x..x..x...x.x...'), { logic: 'OR', maxPatterns: 4 })).toBeNull();
    expect(fitSteps(parseSteps('xx.x...x.xx.x..x.x.xxx..x.x..xx.'), { logic: 'XOR' })).toBeNull();
  });
});

describe('withFit', () => {
  it('mutes the Patterns it does not use and leaves the Channel settings alone', () => {
    const channel = { ...defaultSaveSlot().channels[0]!, width: 30, flop: 1 };
    const out = withFit(channel, fitSteps(parseSteps('x.........x.....'))!);
    expect(out.patterns.map((p) => p.mute)).toEqual([0, 0, 1, 1, 1, 1, 1, 1]);
    expect(out.patterns[1]).toEqual({ mute: 0, chance: 100, length: 16, events: 1, rotate: 10, burst: 1, ratchet: 1, divide: 1 });
    expect(out).toMatchObject({ width: 30, flop: 1, logic: 'OR' });
    expect(channel.patterns[1]!.mute).toBe(1);
  });
});
