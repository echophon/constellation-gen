import type { Logic } from '../format/saveSlot';

// Genre data for the generator. Sources and confidence for each genre are in
// research/genre-patterns.md. Steps are 16th notes, numbered from 0.
//
// A Genre has one Role per Channel, in the manual's Quick Start order:
// I kick, II snare/clap, III closed hat, IV open hat, V rim/perc, then
// VI ghost/accent, VII fill/second perc, VIII bass gate.

export interface Range {
  lo: number;
  hi: number;
}

/** A fixed value, a list to choose from, or an inclusive range. */
export type Value = number | readonly number[] | Range;

/** 0 anchor: what makes it the genre. 1 motif: the Role's main variation. 2 ornament: fills, rolls, ghosts. */
export type Tier = 0 | 1 | 2;

export interface PatternSpec {
  length: Value;
  /** Clamped to the drawn Length. Default 1. */
  events?: Value;
  /** 'any' draws within the Length; 'last' is the final step. Default 0. */
  rotate?: Value | 'any' | 'last';
  burst?: Value;
  ratchet?: Value;
  divide?: Value;
  chance?: Value;
}

/** One or more Patterns that are drawn, kept and rerolled together. */
export interface Layer {
  tier: Tier;
  /** Probability that the Layer is used at all. Default 1. */
  odds?: number;
  /** Step grids to choose from; the choice is fitted with the Recipe's Logic. */
  grid?: readonly string[];
  /** Chance for the Patterns of a grid. */
  chance?: Value;
  /** A single Pattern, for what a grid cannot say: Ratchet, Divide, drawn Lengths. */
  pattern?: PatternSpec;
}

/** One way of playing a Role. */
export interface Recipe {
  id: string;
  weight?: number;
  /** Default OR. */
  logic?: Logic;
  /** Channel Clock [ratchet, divide]. Default [1, 1]. */
  clock?: readonly [number, number];
  /** Default 50. */
  width?: Value;
  flop?: boolean;
  /** Channel rotate: output delay, percent of a Channel Clock step. Default 0. */
  delay?: Value;
  layers: readonly Layer[];
}

export interface Role {
  name: string;
  recipes: readonly Recipe[];
}

export interface Genre {
  id: string;
  name: string;
  bpm: Range;
  swing: Range;
  /** One per Channel. */
  roles: readonly Role[];
}

// ---------- shorthand ----------

const range = (lo: number, hi: number): Range => ({ lo, hi });
const grid = (tier: Tier, choices: string | string[], more: Partial<Layer> = {}): Layer => ({
  tier,
  grid: typeof choices === 'string' ? [choices] : choices,
  ...more,
});
const pat = (tier: Tier, pattern: PatternSpec, odds?: number): Layer => ({ tier, pattern, ...(odds === undefined ? {} : { odds }) });
/** A single Event per bar on one of the given steps. */
const hit = (tier: Tier, steps: number | number[], chance: Value = 100, odds?: number): Layer =>
  pat(tier, { length: 16, rotate: steps, chance }, odds);
const role = (name: string, ...recipes: Recipe[]): Role => ({ name, recipes });
const bars = (...parts: string[]) => parts.join('');

// ---------- recipes shared between genres ----------

const REST: Recipe = { id: 'rest', layers: [] };
const rest = (weight: number): Recipe => ({ ...REST, weight });

const FOUR_FLOOR: Recipe = { id: 'four-floor', layers: [grid(0, 'x...'), hit(2, [11, 14, 15], range(15, 35), 0.5)] };
const BACKBEAT: Recipe = { id: 'backbeat', layers: [grid(0, '....x...'), hit(2, [13, 15], range(10, 30), 0.3)] };
const HATS_16: Recipe = { id: '16ths', layers: [grid(1, 'x')] };
const HATS_8: Recipe = { id: '8ths', layers: [grid(1, 'x.')] };
const HATS_OFF: Recipe = { id: 'offbeat', layers: [grid(1, '..x.')] };
const OPEN_OFF: Recipe = { id: 'offbeat', layers: [grid(1, '..x.')] };

/** 16ths that only sound in the last half-bar of every 2 or 4 bars: a slow Pattern masks a fast one under AND. */
const fill = (id: string, maskLength: number, source: PatternSpec): Recipe => ({
  id,
  logic: 'AND',
  width: 90,
  layers: [pat(2, source), pat(2, { length: maskLength, rotate: 'last', divide: 8 })],
});
const FILL_4: Recipe = fill('fill-4-bars', 8, { length: 1 });
const FILL_2: Recipe = fill('fill-2-bars', 4, { length: 1 });
const FILL_BROKEN: Recipe = fill('broken-fill', 8, { length: 8, events: [5, 7], rotate: 'any' });

/** Flop turns sparse Events into gates: each Event starts or ends a note. */
const bassGate = (id: string, ...layers: Layer[]): Recipe => ({ id, flop: true, layers });
const BASS_EUCLID = bassGate('euclid-gate', pat(1, { length: [8, 16], events: [2, 3, 4, 5], rotate: 'any' }));
const BASS_OFFBEAT = bassGate('offbeat-gate', grid(1, ['..xx', '..x.x...']));

/** Tresillo, cinquillo or E(5,16), turned to any start. */
const PERC_EUCLID: Recipe = { id: 'euclid', layers: [pat(1, { length: [8, 16], events: [3, 5], rotate: 'any' })] };
const GHOSTS: Recipe = {
  id: 'ghosts',
  layers: [pat(2, { length: 16, events: range(2, 4), rotate: 'any', chance: range(40, 70) })],
};
/** A short Ratchet burst at the end of the bar. */
const ROLL: Recipe = {
  id: 'roll',
  layers: [
    pat(2, { length: 8, rotate: [3, 7], divide: 2, ratchet: 3, chance: range(30, 60) }),
    pat(2, { length: 16, rotate: [11, 13, 15], ratchet: 2, chance: range(30, 60) }, 0.6),
  ],
};

// ---------- AND recipes ----------
// Under AND a Channel is high only while every Pattern is high, so a second
// Pattern can say when the first one is allowed to sound. A mask is high for
// Width percent of its own step, and the Width is the Channel's: 90 reaches the
// last 16th of a mask up to 8 pulses long, 95 of one up to 16.

/** A rhythm that sounds only while a mask Pattern is high. The rhythm is the motif, the mask an ornament. */
const masked = (id: string, width: number, source: PatternSpec, mask: PatternSpec, more: Partial<Recipe> = {}): Recipe => ({
  id,
  logic: 'AND',
  width,
  layers: [pat(1, source), pat(2, mask)],
  ...more,
});

const EIGHTHS: PatternSpec = { length: 2 };
const OFFBEATS: PatternSpec = { length: 4, rotate: 2 };
const SIXTEENTHS: PatternSpec = { length: 1 };
const EUCLID: PatternSpec = { length: [8, 16], events: [3, 5], rotate: 'any' };

/** Plays for three bars and rests for the fourth. */
const restBar4 = (id: string, source: PatternSpec): Recipe => masked(id, 95, source, { length: 4, events: 3, divide: 16 });
/** Each bar either plays or stays silent: Chance on the mask decides once per bar, not once per Event. */
const byBar = (id: string, source: PatternSpec): Recipe => masked(id, 95, source, { length: 1, divide: 16, chance: range(45, 75) });
/** The same, decided beat by beat. */
const byBeat = (id: string, source: PatternSpec): Recipe => masked(id, 90, source, { length: 1, divide: 4, chance: range(50, 80) });
/** Only the half-bar or the beat of the rhythm that a Burst window lets through. */
const windowed = (id: string, source: PatternSpec): Recipe[] => [
  masked(`${id}-half-bar`, 50, source, { length: 16, rotate: [0, 8], burst: 8 }),
  masked(`${id}-one-beat`, 50, source, { length: 16, rotate: [4, 8, 12], burst: 4 }),
];

const HATS_REST_BAR_4 = restBar4('8ths-rest-bar-4', EIGHTHS);
const OPEN_REST_BAR_4 = restBar4('offbeat-rest-bar-4', OFFBEATS);
const HATS_BY_BEAT = byBeat('16ths-by-beat', SIXTEENTHS);
const PERC_BY_BAR = byBar('euclid-by-bar', EUCLID);
const PERC_WINDOWED = windowed('euclid', EUCLID);

/** Two short loops that only sound where they coincide: one Event every 12 to 56 steps. */
const COINCIDENCE: Recipe = {
  id: 'coincidence',
  logic: 'AND',
  layers: [pat(1, { length: [3, 5, 7] }), pat(1, { length: [4, 8] })],
};
/** The same with Euclidean loops of different lengths: a sparse line with a long cycle. */
const POLY_ACCENTS: Recipe = {
  id: 'polymeter-accents',
  logic: 'AND',
  layers: [pat(1, { length: [5, 7], events: [2, 3], rotate: 'any' }), pat(1, { length: [8, 16], events: [3, 5, 7], rotate: 'any' })],
};
/** A Ratchet roll in the last beat of every 2 or 4 bars. */
// Width 95, not 90: the last of three Ratchet hits starts 92% of the way through the mask.
const ROLL_FILL: Recipe = {
  id: 'roll-fill',
  logic: 'AND',
  width: 95,
  layers: [pat(2, { length: 1, ratchet: [2, 3] }), pat(2, { length: [8, 16], rotate: 'last', divide: 4 })],
};
/** A slow gate chopped into 16ths: a short stutter once every 1 or 2 bars. */
const STUTTER: Recipe = masked('stutter', 50, SIXTEENTHS, { length: [2, 4], rotate: 'any', divide: [4, 8] });

// ---------- genres ----------

const HOUSE: Genre = {
  id: 'house',
  name: 'House',
  bpm: range(118, 128),
  swing: range(54, 60),
  roles: [
    role('kick', FOUR_FLOOR),
    role('clap', BACKBEAT),
    role('closed hat', { ...HATS_16, weight: 2 }, HATS_8, { id: 'shuffle', layers: [grid(1, ['x.xx', '.xxx'])] }),
    role('open hat', { ...OPEN_OFF, weight: 2 }, OPEN_REST_BAR_4),
    role('perc', { ...PERC_EUCLID, weight: 2 }, PERC_BY_BAR, ...PERC_WINDOWED),
    role('shaker', GHOSTS, rest(1)),
    role('fill', FILL_4, FILL_2, ROLL_FILL, rest(2)),
    role('bass', BASS_OFFBEAT, BASS_EUCLID),
  ],
};

const TECHNO: Genre = {
  id: 'techno',
  name: 'Techno',
  bpm: range(125, 145),
  swing: range(50, 55),
  roles: [
    role('kick', { ...FOUR_FLOOR, weight: 3 }, { id: 'four-floor-push', layers: [grid(0, 'x...x...x...x.x.')] }),
    role('clap', { id: 'sparse', layers: [grid(0, ['....x.......x...', '............x...'])] }, rest(1)),
    role('closed hat', HATS_OFF, HATS_16, HATS_BY_BEAT),
    role(
      'rumble',
      // 16ths with the kick's steps removed.
      { id: 'rumble', logic: 'XOR', layers: [pat(0, { length: 1 }), pat(0, { length: 4 })] },
      OPEN_OFF,
    ),
    role('perc', {
      id: 'polymeter',
      layers: [
        pat(1, { length: [3, 5, 6, 7, 12], events: range(1, 3), rotate: 'any' }),
        pat(1, { length: [5, 7, 9, 11], events: range(1, 2), rotate: 'any' }, 0.6),
      ],
      weight: 2,
    }, PERC_BY_BAR, STUTTER),
    role('perc 2', {
      id: 'xor-polymeter',
      logic: 'XOR',
      layers: [
        pat(1, { length: 16, events: [5, 7], rotate: 'any' }),
        pat(1, { length: [7, 12], events: range(2, 3), rotate: 'any' }),
      ],
    }, POLY_ACCENTS),
    role('fill', FILL_4, FILL_BROKEN, ROLL_FILL, rest(2)),
    role('bass', BASS_EUCLID),
  ],
};

const TWO_STEP_KICK = ['x.........x.....', 'x..x......x.....', 'x.........xx....'];

const DNB: Genre = {
  id: 'dnb',
  name: 'Drum and bass',
  bpm: range(170, 176),
  swing: range(50, 54),
  roles: [
    role('kick', { id: 'two-step', layers: [grid(0, TWO_STEP_KICK), hit(2, [7, 11, 13], range(20, 50), 0.6)] }),
    role('snare', BACKBEAT),
    role('closed hat', HATS_8, HATS_16),
    role('open hat', { id: 'offbeat', layers: [grid(1, ['..x.', '......x.'])] }, OPEN_REST_BAR_4, rest(1)),
    role('rim', {
      id: 'chance-hits',
      layers: [hit(2, [7, 9, 15], range(40, 80)), hit(2, [3, 6, 14], range(40, 80), 0.5)],
      weight: 2,
    }, COINCIDENCE),
    role('ghost snare', { id: 'amen-ghosts', layers: [grid(1, '.......x.x.....x', { chance: range(50, 90) })] }, rest(1)),
    role('fill', FILL_4, FILL_BROKEN, ROLL_FILL, rest(1)),
    role('bass', BASS_EUCLID),
  ],
};

// The Amen break over four bars; ghost notes are a Role of their own because there is no velocity.
const AMEN_KICK = bars('x.x.......xx....', 'x.x.......xx....', 'x.x.......x.....', '..xx......x.....');
const AMEN_SNARE = bars('....x.......x...', '....x.......x...', '....x.........x.', '....x.........x.');
const AMEN_GHOST = bars('.......x.x.....x', '.......x.x.....x', '.......x.x......', '.x.....x.x......');
const AMEN_CRASH = bars('................', '................', '................', '..........x.....');

const JUNGLE: Genre = {
  id: 'jungle',
  name: 'Jungle',
  bpm: range(160, 172),
  swing: range(50, 50),
  roles: [
    role(
      'kick',
      { id: 'amen-4-bars', layers: [grid(0, AMEN_KICK)] },
      { id: 'amen-1-bar', layers: [grid(0, 'x.x.......xx....'), hit(2, [3, 13], range(20, 40), 0.5)] },
    ),
    role('snare', { id: 'amen-4-bars', layers: [grid(0, AMEN_SNARE)] }),
    role('ride', HATS_8),
    role('crash', { id: 'amen-crash', layers: [grid(1, AMEN_CRASH)] }, COINCIDENCE, rest(1)),
    role('rim', { id: 'chance-hits', layers: [hit(2, [3, 6, 11, 14], range(30, 60)), hit(2, [1, 13], range(30, 60), 0.5)] }),
    role('ghost snare', { id: 'amen-ghosts', layers: [grid(1, AMEN_GHOST)] }),
    role('fill', FILL_BROKEN, FILL_4, ROLL_FILL, rest(1)),
    role('bass', BASS_EUCLID),
  ],
};

const IDM: Genre = {
  id: 'idm',
  name: 'IDM',
  bpm: range(90, 160),
  swing: range(50, 58),
  roles: [
    role('kick', {
      id: 'skeleton',
      layers: [
        grid(0, ['x.........x.....', 'x.......x.......', 'x.....x.........']),
        pat(2, { length: [5, 7, 11], rotate: 'any', chance: range(30, 60) }),
      ],
    }),
    role('snare', {
      id: 'skeleton',
      layers: [
        grid(0, ['....x.......x...', '........x.......']),
        pat(2, { length: 16, rotate: 'any', ratchet: [2, 3, 4], chance: range(20, 50) }),
      ],
    }),
    role(
      'hat',
      { id: 'triplets', clock: [3, 2], layers: [pat(1, { length: [6, 12], events: range(3, 7), rotate: 'any' })] },
      { id: 'quintuplets', clock: [5, 4], layers: [pat(1, { length: [5, 10], events: range(2, 6), rotate: 'any' })] },
      {
        id: 'xor',
        logic: 'XOR',
        layers: [pat(1, { length: 2 }), pat(1, { length: [5, 7, 9], events: range(1, 3), rotate: 'any' })],
      },
    ),
    role('perc', {
      id: 'xor-polymeter',
      logic: 'XOR',
      layers: [
        pat(1, { length: 16, events: [5, 7, 9], rotate: 'any' }),
        pat(1, { length: [7, 9, 11, 13], events: range(2, 5), rotate: 'any' }),
      ],
    }, POLY_ACCENTS),
    role('glitch', {
      id: 'ratchets',
      layers: [
        pat(1, { length: [7, 9, 11, 13], events: range(1, 2), rotate: 'any', ratchet: [3, 4, 6, 8], chance: range(40, 80) }),
      ],
    }, STUTTER, HATS_BY_BEAT),
    role('gates', {
      id: 'flop',
      flop: true,
      layers: [
        pat(1, { length: [5, 7, 9], events: range(2, 3), rotate: 'any' }),
        pat(1, { length: 16, events: [3, 5], rotate: 'any' }, 0.5),
      ],
    }),
    role('septuplets', { id: '7-over-4', clock: [7, 4], layers: [pat(1, { length: 7, events: range(2, 4), rotate: 'any' })] }, rest(1)),
    role('bass', bassGate('polymeter-gate', pat(1, { length: [6, 7, 12], events: range(2, 3), rotate: 'any' }))),
  ],
};

/** Hats with a Ratchet roll over them. */
const hatsWithRolls = (id: string, hats: string): Recipe => ({ id, layers: [grid(0, hats), ...ROLL.layers] });

const DRILL: Genre = {
  id: 'drill',
  name: 'UK drill',
  bpm: range(138, 144),
  swing: range(50, 50),
  roles: [
    role('kick', {
      id: 'syncopated',
      layers: [hit(0, 0), hit(1, [6, 7]), hit(1, [10, 11, 14]), pat(2, { length: 32, rotate: [19, 22, 27], chance: range(40, 100) }, 0.6)],
    }),
    // Beat 3 of the first bar, beat 4 of the second.
    role('snare', { id: 'counter-snare', layers: [grid(0, bars('........x.......', '............x...'))] }),
    role('closed hat', hatsWithRolls('tresillo', 'x..x..x.')),
    role('open hat', { id: 'sparse', layers: [hit(1, [2, 10, 14])] }, rest(1)),
    role('perc', { id: 'counter', layers: [pat(1, { length: 32, rotate: [14, 20, 30], chance: range(60, 100) })] }, COINCIDENCE),
    role('ghost', GHOSTS, rest(2)),
    role('fill', FILL_4, ROLL_FILL, rest(2)),
    role('808', bassGate('follows-kick', hit(1, 0), hit(1, [6, 7, 10]))),
  ],
};

const TRAP: Genre = {
  id: 'trap',
  name: 'Trap',
  bpm: range(130, 150),
  swing: range(50, 50),
  roles: [
    role('kick', { id: 'sparse', layers: [hit(0, 0), hit(1, [3, 6, 7]), hit(1, [10, 11, 14], 100, 0.7)] }),
    role('snare', { id: 'half-time', layers: [grid(0, '........x.......'), pat(2, { length: 32, rotate: [30, 31], chance: range(40, 80) }, 0.5)] }),
    role('closed hat', hatsWithRolls('8ths', 'x.'), hatsWithRolls('16ths', 'x')),
    role('open hat', { id: 'sparse', layers: [hit(1, [6, 10, 14])] }, rest(1)),
    role('perc', PERC_EUCLID, PERC_BY_BAR, rest(1)),
    role('ghost', GHOSTS, rest(2)),
    role('fill', FILL_4, ROLL_FILL, rest(1)),
    role('808', bassGate('follows-kick', hit(1, 0), hit(1, [3, 6, 7, 10]))),
  ],
};

const BOOM_BAP: Genre = {
  id: 'boombap',
  name: 'Boom bap',
  bpm: range(85, 96),
  swing: range(58, 66),
  roles: [
    role('kick', {
      id: 'boom',
      layers: [
        grid(0, ['x......x..x.....', 'x..x....x.x.....', 'x.......x.x.....', 'x.....x...x.....']),
        hit(2, [7, 9, 15], range(20, 50), 0.6),
      ],
    }),
    // The late snare is optional: Roger Linn argues against it.
    role('snare', BACKBEAT, { id: 'late-backbeat', delay: range(5, 15), layers: [grid(0, '....x...')] }),
    role('closed hat', { ...HATS_8, weight: 2 }, { id: '8ths-and-swung', layers: [grid(1, 'x.'), pat(2, { length: 2, rotate: 1, chance: range(20, 50) })] }),
    role('open hat', { id: 'sparse', layers: [hit(1, [6, 10, 14], range(60, 100))] }, rest(1)),
    role('rim', { id: 'euclid', layers: [pat(1, { length: 16, events: [2, 3], rotate: 'any', chance: range(60, 100) })] }, PERC_BY_BAR, rest(1)),
    // The 16th before beats 2 and 4, where swing is heard most.
    role('ghost snare', { id: 'before-backbeat', layers: [pat(1, { length: 8, rotate: 3, chance: range(40, 70) }), hit(2, [9, 15], range(20, 50), 0.5)] }),
    role('shaker', rest(2), { id: '16ths', layers: [pat(1, { length: 1, chance: range(70, 100) })] }, HATS_REST_BAR_4),
    role('bass', BASS_EUCLID),
  ],
};

const GARAGE: Genre = {
  id: 'garage',
  name: '2-step garage',
  bpm: range(126, 134),
  swing: range(60, 66),
  roles: [
    role(
      'kick',
      { id: 'two-step', layers: [grid(0, ['x.........x.....', 'x......x..x.....', 'x.........x..x..'])] },
      // No kick on the downbeat of the second bar.
      { id: 'skip-downbeat', logic: 'XOR', layers: [hit(0, 0), hit(0, 10), pat(1, { length: 32, rotate: 16 })] },
    ),
    role('snare', BACKBEAT),
    role('closed hat', HATS_OFF),
    role('shaker', { id: '16ths', layers: [pat(1, { length: 1, chance: range(70, 100) })], weight: 2 }, HATS_BY_BEAT),
    role('perc', { ...PERC_EUCLID, weight: 2 }, ...PERC_WINDOWED),
    role('ghost snare', { id: 'chance-hits', layers: [hit(2, [7, 9, 15], range(40, 70)), hit(2, [1, 3, 11], range(30, 60), 0.5)] }),
    role('fill', FILL_2, FILL_4, rest(2)),
    role('bass', BASS_EUCLID, BASS_OFFBEAT),
  ],
};

const JUKE: Genre = {
  id: 'juke',
  name: 'Juke / footwork',
  bpm: range(155, 165),
  swing: range(50, 50),
  roles: [
    role(
      'kick',
      { id: 'tresillo', layers: [grid(0, ['x..x..x.', 'x..x..x...x..x..'])] },
      // Pairs of 32nd notes on a doubled Channel Clock.
      {
        id: '32nd-pairs',
        clock: [2, 1],
        layers: [pat(0, { length: 8, burst: 2 }), pat(2, { length: [16, 32], events: [3, 5], rotate: 'any', chance: range(40, 70) })],
      },
    ),
    role('clap', { id: 'half-time', layers: [grid(0, '............x...')] }, { id: 'full-time', layers: [grid(0, '....x...')] }),
    role('closed hat', HATS_OFF, HATS_16),
    role('open hat', OPEN_OFF, OPEN_REST_BAR_4, rest(1)),
    role('toms', { id: 'triplets', clock: [3, 2], layers: [pat(1, { length: [6, 12], events: range(2, 5), rotate: 'any', chance: range(50, 80) })] }),
    role('toms 2', { id: 'slow-triplets', clock: [3, 4], layers: [pat(1, { length: 12, events: [5, 7], rotate: 'any', chance: range(50, 80) })] }, rest(1)),
    role('snare roll', { id: 'roll', layers: [pat(2, { length: 16, rotate: [6, 14], burst: 2, ratchet: 2, chance: range(40, 70) })] }, ROLL_FILL, STUTTER, rest(1)),
    role('sub', BASS_EUCLID),
  ],
};

const JERSEY: Genre = {
  id: 'jersey',
  name: 'Jersey club',
  bpm: range(130, 145),
  swing: range(50, 54),
  roles: [
    // E(5,16) with one Event moved a step: two Patterns under XOR.
    role('kick', { id: 'five-kick', logic: 'XOR', layers: [grid(0, 'x...x...x..x..x.')] }),
    role('clap', BACKBEAT),
    role('closed hat', HATS_8, HATS_16),
    role('open hat', OPEN_OFF),
    role('perc', { ...PERC_EUCLID, weight: 2 }, ...PERC_WINDOWED),
    role('ghost', GHOSTS, rest(1)),
    role('roll', ROLL, FILL_2, ROLL_FILL, rest(1)),
    role('bass', BASS_EUCLID),
  ],
};

const DEMBOW: Genre = {
  id: 'dembow',
  name: 'Dembow',
  bpm: range(88, 100),
  swing: range(50, 54),
  roles: [
    role('kick', FOUR_FLOOR),
    // The tresillo without its downbeat.
    role('snare', { id: 'dembow', layers: [grid(0, '...x..x.'), hit(2, [15, 13], range(20, 40), 0.4)] }),
    role('closed hat', HATS_8, HATS_16),
    role('open hat', OPEN_OFF, rest(1)),
    role('timbal', { id: 'cinquillo', layers: [pat(1, { length: 8, events: 5, rotate: 'any' })] }, PERC_EUCLID, ...PERC_WINDOWED),
    role('ghost', GHOSTS, rest(1)),
    role('fill', FILL_4, ROLL_FILL, rest(1)),
    role('bass', bassGate('tresillo-gate', grid(1, ['x..x..x.', '...x..x.']))),
  ],
};

const SON_CLAVES = ['x..x..x...x.x...', '..x.x...x..x..x.', 'x..x...x..x.x...'];

const AFRO_CUBAN: Genre = {
  id: 'afrocuban',
  name: 'Afro-Cuban',
  bpm: range(95, 125),
  swing: range(50, 50),
  roles: [
    role('bass drum', { id: 'tresillo', layers: [grid(0, ['x..x..x.', '...x..x.'])] }),
    // Son 3-2, son 2-3, rumba 3-2: each is E(5,16) with one Event moved.
    role('clave', { id: 'clave', logic: 'XOR', layers: [grid(0, SON_CLAVES)] }),
    role('cascara', { id: 'cinquillo', layers: [pat(0, { length: 8, events: 5, rotate: [0, 3, 5] })] }),
    role('cowbell', { id: 'pulse', layers: [grid(1, ['x...', 'x.x.'])], weight: 2 }, restBar4('pulse-rest-bar-4', EIGHTHS)),
    role('conga', { id: 'dense-euclid', layers: [pat(1, { length: 16, events: [7, 9], rotate: 'any' })] }),
    role('guiro', { id: 'cumbia', layers: [pat(1, { length: 4, events: 3, rotate: 2 })] }, rest(1)),
    role('timbale', FILL_4, FILL_BROKEN, ROLL_FILL, rest(1)),
    role('bass', bassGate('tumbao-gate', grid(1, ['...x..x.', 'x..x..x.']))),
  ],
};

const BRAZIL: Genre = {
  id: 'brazil',
  name: 'Samba / bossa nova',
  bpm: range(90, 130),
  swing: range(50, 54),
  roles: [
    role('surdo', { id: 'surdo', layers: [grid(0, ['x..xx..x', 'x...'])] }),
    // The bossa nova clave: E(5,16) started on its third or fourth Event.
    role('rim', { id: 'bossa-clave', layers: [pat(0, { length: 16, events: 5, rotate: [10, 13] })] }),
    role('shaker', HATS_16),
    role('tamborim', { id: 'samba', layers: [pat(1, { length: 16, events: 7, rotate: [2, 0] })] }),
    role('agogo', { id: 'cowbell', layers: [pat(1, { length: 16, events: 9, rotate: 'any' })] }, rest(1)),
    role('perc', PERC_EUCLID, PERC_BY_BAR, ...PERC_WINDOWED, rest(1)),
    role('fill', FILL_4, ROLL_FILL, rest(2)),
    role('bass', BASS_EUCLID),
  ],
};

// Twelve steps to the bar: every Channel runs at 3:4 of the Main Clock.
const twelve = (id: string, ...layers: Layer[]): Recipe => ({ id, clock: [3, 4], layers });

const BELL: Genre = {
  id: 'bell',
  name: 'West African 12/8',
  bpm: range(100, 130),
  swing: range(50, 50),
  roles: [
    role('low drum', twelve('pulse', grid(0, ['x..x..x..x..', 'x.....x.....']))),
    // The standard bell pattern, started as Mpre or as bembé.
    role('bell', twelve('standard-bell', pat(0, { length: 12, events: 7, rotate: [0, 9] }))),
    role('shaker', twelve('tumbao', pat(1, { length: 3, events: 2, rotate: [0, 1, 2] }))),
    role('clap', twelve('venda', pat(1, { length: 12, events: 5, rotate: 'any' })), twelve('fandango', grid(1, 'x..'))),
    role(
      'drum',
      { ...twelve('euclid', pat(1, { length: 12, events: [4, 5], rotate: 'any' })), weight: 2 },
      // One mask step is a bar of twelve.
      { ...masked('euclid-by-bar', 95, { length: 12, events: [4, 5], rotate: 'any' }, { length: 1, divide: 12, chance: range(45, 75) }), clock: [3, 4] },
    ),
    // Three evenly spaced Events against the four beats.
    role('cross rhythm', twelve('three-over-four', pat(1, { length: 4, rotate: 'any' })), rest(1)),
    role('ghost', twelve('ghosts', pat(2, { length: 12, events: range(2, 4), rotate: 'any', chance: range(40, 70) })), rest(1)),
    role('bass', { ...twelve('gate', pat(1, { length: 12, events: [2, 3, 4], rotate: 'any' })), flop: true }),
  ],
};

/** An odd meter in 16ths: every Pattern is `steps` long or a multiple. */
const oddMeter = (id: string, name: string, steps: number, bpm: Range, bell: number[]): Genre => ({
  id,
  name,
  bpm,
  swing: range(50, 50),
  roles: [
    role('kick', { id: 'downbeat', layers: [pat(0, { length: steps }), pat(2, { length: steps, rotate: 'any', chance: range(30, 60) }, 0.5)] }),
    role('snare', { id: 'metric', layers: [pat(0, { length: steps, events: bell, rotate: 0 })] }),
    role('closed hat', HATS_16, HATS_8),
    role('open hat', { id: 'two-bar', layers: [pat(1, { length: steps * 2, events: [1, 2, 3], rotate: 'any' })] }, rest(1)),
    role(
      'perc',
      { id: 'euclid', weight: 2, layers: [pat(1, { length: steps, events: range(2, steps - 2), rotate: 'any' })] },
      // One mask step is a bar.
      masked('euclid-by-bar', 95, { length: steps, events: range(2, steps - 2), rotate: 'any' }, { length: 1, divide: steps, chance: range(45, 75) }),
    ),
    role('ghost', { id: 'ghosts', layers: [pat(2, { length: steps * 2, events: range(2, 4), rotate: 'any', chance: range(40, 70) })] }, rest(1)),
    role('four against', { id: 'straight-four', layers: [pat(1, { length: 4, rotate: 'any' })] }, rest(2)),
    role('bass', bassGate('gate', pat(1, { length: steps, events: [2, 3], rotate: 'any' }))),
  ],
});

// Ruchenitza is E(3,7) or E(4,7); aksak is E(4,9), with E(5,9) as agsag-samai.
const RUCHENITZA = oddMeter('ruchenitza', 'Ruchenitza 7/8', 7, range(110, 150), [3, 4]);
const AKSAK = oddMeter('aksak', 'Aksak 9/8', 9, range(110, 150), [4, 5]);

export const GENRES: readonly Genre[] = [
  HOUSE, TECHNO, DNB, JUNGLE, IDM, DRILL, TRAP, BOOM_BAP, GARAGE, JUKE, JERSEY, DEMBOW,
  AFRO_CUBAN, BRAZIL, BELL, RUCHENITZA, AKSAK,
];

export function genreById(id: string): Genre | undefined {
  return GENRES.find((g) => g.id === id);
}
