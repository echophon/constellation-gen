// A minimal zip writer: files are stored, not compressed. A Bank is about
// 45 KB of text, so compression is not worth a dependency.

export interface ZipEntry {
  name: string;
  text: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The entries as one zip archive. Names must be ASCII. */
export function zip(entries: ZipEntry[], modified = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const time = (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1);
  const date = ((Math.max(1980, modified.getFullYear()) - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate();

  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    // Shared by the local header (after its signature) and the central directory record.
    const common = new DataView(new ArrayBuffer(26));
    common.setUint16(0, 20, true); // version needed
    common.setUint16(2, 0, true); // flags
    common.setUint16(4, 0, true); // method: stored
    common.setUint16(6, time, true);
    common.setUint16(8, date, true);
    common.setUint32(10, crc32(data), true);
    common.setUint32(14, data.length, true);
    common.setUint32(18, data.length, true);
    common.setUint16(22, name.length, true);
    common.setUint16(24, 0, true); // extra length
    const fields = new Uint8Array(common.buffer);

    const local = new Uint8Array(4 + 26 + name.length);
    new DataView(local.buffer).setUint32(0, 0x04034b50, true);
    local.set(fields, 4);
    local.set(name, 30);

    const record = new Uint8Array(46 + name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true); // version made by
    record.set(fields, 6);
    // comment length, disk, internal and external attributes stay 0
    view.setUint32(42, offset, true);
    record.set(name, 46);

    parts.push(local, data);
    directory.push(record);
    offset += local.length + data.length;
  }

  const directorySize = directory.reduce((n, r) => n + r.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);

  const out = new Uint8Array(offset + directorySize + 22);
  let at = 0;
  for (const part of [...parts, ...directory, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
