// Save Slot file format (firmware V1.3). Field order confirmed against files
// written by the module; see hardware/ and research/save-slot-format.md.
//
// Values are kept exactly as written in the file, with no clamping, so that
// parse followed by serialize is lossless. The engine normalises on its side.

export type Logic = 'AND' | 'OR' | 'XOR';

export interface Pattern {
  mute: number;
  chance: number;
  length: number;
  events: number;
  rotate: number;
  burst: number;
  ratchet: number;
  divide: number;
}

export interface Channel {
  mute: number;
  flop: number;
  /** Channel Clock multiplier. */
  ratchet: number;
  /** Channel Clock divider. */
  divide: number;
  width: number;
  /** Output microtiming delay. */
  rotate: number;
  logic: Logic;
  patterns: Pattern[];
}

export interface MainClock {
  /** 1 when the internal Main Clock is stopped. */
  mute: number;
  /** Purpose unknown; always 1 in files written by the module. */
  flag: number;
  bpm: number;
  ratchet: number;
  divide: number;
  extRatchet: number;
  extDivide: number;
  /** Main Clock Width: 50 (straight) to 90. */
  swing: number;
}

export interface CvAssignment {
  assigned: number;
  random: number;
  /** 1 mute, 10 width, 20 divide, 21 length, 22 events, 23 rotate, 24 burst, 25 ratchet, 26 chance, 29 load. */
  target: number;
  channel: number;
  pattern: number;
  /** Attenuverter × 100, -100..100. */
  attenuation: number;
}

export interface SaveSlot {
  clock: MainClock;
  cv: CvAssignment[];
  channels: Channel[];
}

export const CHANNEL_COUNT = 8;
export const PATTERN_COUNT = 8;
export const CV_COUNT = 10;

const LOGICS: readonly string[] = ['AND', 'OR', 'XOR'];

export function defaultPattern(index: number): Pattern {
  return { mute: index === 0 ? 0 : 1, chance: 100, length: 4, events: 1, rotate: 0, burst: 1, ratchet: 1, divide: 1 };
}

export function defaultChannel(): Channel {
  return {
    mute: 0,
    flop: 0,
    ratchet: 1,
    divide: 1,
    width: 50,
    rotate: 0,
    logic: 'OR',
    patterns: Array.from({ length: PATTERN_COUNT }, (_, p) => defaultPattern(p)),
  };
}

export function defaultClock(): MainClock {
  return { mute: 0, flag: 1, bpm: 120, ratchet: 4, divide: 1, extRatchet: 1, extDivide: 1, swing: 50 };
}

export function defaultCv(): CvAssignment {
  return { assigned: 0, random: 0, target: 0, channel: 0, pattern: 0, attenuation: 100 };
}

/** The firmware's built-in default: what a never-saved Save Slot contains. */
export function defaultSaveSlot(): SaveSlot {
  return {
    clock: defaultClock(),
    cv: Array.from({ length: CV_COUNT }, defaultCv),
    channels: Array.from({ length: CHANNEL_COUNT }, defaultChannel),
  };
}

export class SaveSlotParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
  }
}

const LINE = /^(clock|cv(\d+)|C(\d+)(?:\.P(\d+))?) = (\S+)$/;

function ints(values: string[], lineNo: number): number[] {
  return values.map((v) => {
    if (!/^-?\d+$/.test(v)) throw new SaveSlotParseError(`"${v}" is not an integer`, lineNo);
    return parseInt(v, 10);
  });
}

function expectCount(values: string[], count: number, key: string, lineNo: number): void {
  if (values.length !== count) {
    throw new SaveSlotParseError(`${key} needs ${count} fields, found ${values.length}`, lineNo);
  }
}

/**
 * Parses a Save Slot the way the firmware does: lines in any order, missing
 * lines left at their default, unrecognised lines skipped, CRLF tolerated.
 * A recognised key with the wrong number of fields is an error.
 */
export function parseSaveSlot(text: string): SaveSlot {
  const slot = defaultSaveSlot();
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const match = LINE.exec(raw.replace(/\r$/, ''));
    if (!match) return;
    const [, key, cvIdx, chIdx, patIdx, list] = match;
    const values = list!.split(',');

    if (key === 'clock') {
      expectCount(values, 8, 'clock', lineNo);
      const [mute, flag, bpm, ratchet, divide, extRatchet, extDivide, swing] = ints(values, lineNo) as [
        number, number, number, number, number, number, number, number,
      ];
      slot.clock = { mute, flag, bpm, ratchet, divide, extRatchet, extDivide, swing };
    } else if (cvIdx !== undefined) {
      const n = parseInt(cvIdx, 10);
      if (n >= CV_COUNT) return;
      expectCount(values, 6, key!, lineNo);
      const [assigned, random, target, channel, pattern, attenuation] = ints(values, lineNo) as [
        number, number, number, number, number, number,
      ];
      slot.cv[n] = { assigned, random, target, channel, pattern, attenuation };
    } else if (patIdx !== undefined) {
      const c = parseInt(chIdx!, 10);
      const p = parseInt(patIdx, 10);
      if (c >= CHANNEL_COUNT || p >= PATTERN_COUNT) return;
      expectCount(values, 8, key!, lineNo);
      const [mute, chance, length, events, rotate, burst, ratchet, divide] = ints(values, lineNo) as [
        number, number, number, number, number, number, number, number,
      ];
      slot.channels[c]!.patterns[p] = { mute, chance, length, events, rotate, burst, ratchet, divide };
    } else {
      const c = parseInt(chIdx!, 10);
      if (c >= CHANNEL_COUNT) return;
      expectCount(values, 7, key!, lineNo);
      const logic = values[6]!;
      if (!LOGICS.includes(logic)) throw new SaveSlotParseError(`unknown Logic "${logic}"`, lineNo);
      const [mute, flop, ratchet, divide, width, rotate] = ints(values.slice(0, 6), lineNo) as [
        number, number, number, number, number, number,
      ];
      Object.assign(slot.channels[c]!, { mute, flop, ratchet, divide, width, rotate, logic: logic as Logic });
    }
  });
  return slot;
}

/** Writes the 83-line, LF-terminated file the firmware writes. */
export function serializeSaveSlot(slot: SaveSlot): string {
  const c = slot.clock;
  const out = [
    `clock = ${[c.mute, c.flag, c.bpm, c.ratchet, c.divide, c.extRatchet, c.extDivide, c.swing].join(',')}`,
  ];
  slot.cv.forEach((v, i) => {
    out.push(`cv${i} = ${[v.assigned, v.random, v.target, v.channel, v.pattern, v.attenuation].join(',')}`);
  });
  slot.channels.forEach((ch, i) => {
    out.push(`C${i} = ${[ch.mute, ch.flop, ch.ratchet, ch.divide, ch.width, ch.rotate, ch.logic].join(',')}`);
    ch.patterns.forEach((p, j) => {
      out.push(
        `C${i}.P${j} = ${[p.mute, p.chance, p.length, p.events, p.rotate, p.burst, p.ratchet, p.divide].join(',')}`,
      );
    });
  });
  return out.join('\n') + '\n';
}
