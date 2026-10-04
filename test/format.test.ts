import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SaveSlotParseError, defaultSaveSlot, parseSaveSlot, serializeSaveSlot } from '../src/format/saveSlot';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function slotFiles(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => /^\d\d\.TXT$/.test(f))
    .map((f) => join(dir, f));
}

// Factory Bank, plus every Bank the module itself wrote during the hardware capture.
const written = ['000', 'hardware/mid-card/000', 'hardware/mid-card/002', 'hardware/mid-card/009', 'hardware/mid-card/011'].flatMap(slotFiles);

describe('Save Slot format', () => {
  it('finds captured files to test against', () => {
    expect(written.length).toBeGreaterThanOrEqual(20);
  });

  it.each(written)('round-trips %s byte for byte', (file) => {
    const text = read(file);
    expect(serializeSaveSlot(parseSaveSlot(text))).toBe(text);
  });

  it('serializes the built-in default as 83 LF lines', () => {
    const text = serializeSaveSlot(defaultSaveSlot());
    expect(text.split('\n')).toHaveLength(84);
    expect(text).not.toContain('\r');
    expect(text.startsWith('clock = 0,1,120,4,1,1,1,50\ncv0 = 0,0,0,0,0,100\n')).toBe(true);
    expect(text.endsWith('C7.P7 = 1,100,4,1,0,1,1,1\n')).toBe(true);
  });

  it('reads the confirmed field order', () => {
    const slot = parseSaveSlot('clock = 1,1,97,5,3,6,7,66\nC2 = 0,1,3,2,25,37,XOR\nC7.P1 = 0,80,8,7,6,2,255,254\ncv8 = 1,0,22,3,1,-58\n');
    expect(slot.clock).toEqual({ mute: 1, flag: 1, bpm: 97, ratchet: 5, divide: 3, extRatchet: 6, extDivide: 7, swing: 66 });
    expect(slot.channels[2]).toMatchObject({ mute: 0, flop: 1, ratchet: 3, divide: 2, width: 25, rotate: 37, logic: 'XOR' });
    expect(slot.channels[7]!.patterns[1]).toEqual({ mute: 0, chance: 80, length: 8, events: 7, rotate: 6, burst: 2, ratchet: 255, divide: 254 });
    expect(slot.cv[8]).toEqual({ assigned: 1, random: 0, target: 22, channel: 3, pattern: 1, attenuation: -58 });
  });

  it('tolerates what the module tolerates', () => {
    const base = serializeSaveSlot(defaultSaveSlot()).replace('C0.P0 = 0,100,4,1', 'C0.P0 = 0,100,21,3');
    const lines = base.trimEnd().split('\n');
    const variants = {
      crlf: lines.join('\r\n') + '\r\n',
      noTrailingNewline: lines.join('\n'),
      reversed: [...lines].reverse().join('\n') + '\n',
      unknownLine: base + 'foo = 1,2,3\n',
    };
    for (const text of Object.values(variants)) {
      expect(serializeSaveSlot(parseSaveSlot(text))).toBe(base);
    }
    const partial = parseSaveSlot('C0.P0 = 0,100,25,3,0,1,1,1\n');
    expect(partial.channels[0]!.patterns[0]!.length).toBe(25);
    expect(partial.channels[1]).toEqual(defaultSaveSlot().channels[1]);
  });

  it('keeps out-of-range values as written', () => {
    const slot = parseSaveSlot('C0.P0 = 0,100,26,40,35,1,300,256\n');
    expect(slot.channels[0]!.patterns[0]).toMatchObject({ events: 40, rotate: 35, ratchet: 300, divide: 256 });
  });

  it('rejects a wrong field count or unknown Logic', () => {
    expect(() => parseSaveSlot('C0 = 0,0,1,1,50,0\n')).toThrow(SaveSlotParseError);
    expect(() => parseSaveSlot('C0 = 0,0,1,1,50,0,NAND\n')).toThrow(/unknown Logic/);
    expect(() => parseSaveSlot('clock = 0,1,120\n')).toThrow(/needs 8 fields/);
  });
});
