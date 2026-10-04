import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, zip } from '../src/format/zip';

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('zip', () => {
  const entries = [
    { name: '00.TXT', text: 'clock = 0,1,120,4,1,1,1,50\n' },
    { name: 'BANK.JSN', text: '{"version":1}\n' },
    { name: 'EMPTY.TXT', text: '' },
  ];
  const bytes = zip(entries, new Date(2026, 9, 3, 12, 30, 0));

  it('lists every entry in its central directory', () => {
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(entries.length);
    let at = view.getUint32(end + 16, true);
    for (const entry of entries) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const nameLength = view.getUint16(at + 28, true);
      expect(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))).toBe(entry.name);
      // The record points at a local header followed by the stored text.
      const local = view.getUint32(at + 42, true);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      const size = view.getUint32(at + 24, true);
      expect(new TextDecoder().decode(bytes.subarray(local + 30 + nameLength, local + 30 + nameLength + size))).toBe(entry.text);
      at += 46 + nameLength;
    }
  });

  it('extracts with the system unzip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'constellation-zip-'));
    writeFileSync(join(dir, 'bank.zip'), bytes);
    execFileSync('unzip', ['-q', 'bank.zip'], { cwd: dir });
    for (const entry of entries) expect(readFileSync(join(dir, entry.name), 'utf8')).toBe(entry.text);
  });
});
