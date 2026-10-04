import { describe, expect, it } from 'vitest';
import { moveCursor, parseKey, type Cursor } from '../src/app/keys';

describe('parseKey', () => {
  it('moves with h j k l', () => {
    expect(['h', 'j', 'k', 'l'].map(parseKey)).toEqual([
      { type: 'move', rows: 0, cols: -1 },
      { type: 'move', rows: 1, cols: 0 },
      { type: 'move', rows: -1, cols: 0 },
      { type: 'move', rows: 0, cols: 1 },
    ]);
  });

  it('moves with the arrow keys too', () => {
    expect(['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'].map(parseKey)).toEqual(['h', 'j', 'k', 'l'].map(parseKey));
  });

  it('raises with i and lowers with u', () => {
    expect(['i', 'u'].map(parseKey)).toEqual([
      { type: 'bump', delta: 1 },
      { type: 'bump', delta: -1 },
    ]);
  });

  it('selects a Channel with 1 to 8', () => {
    expect(parseKey('1')).toEqual({ type: 'channel', index: 0 });
    expect(parseKey('8')).toEqual({ type: 'channel', index: 7 });
    expect(parseKey('9')).toBeNull();
    expect(parseKey('0')).toBeNull();
  });

  it('steps through Save Slots with [ and ]', () => {
    expect(['[', ']'].map(parseKey)).toEqual([
      { type: 'slotBy', delta: -1 },
      { type: 'slotBy', delta: 1 },
    ]);
  });

  it('plays and stops with space', () => {
    expect(parseKey(' ')).toEqual({ type: 'play' });
  });

  it('mutes with m or x', () => {
    expect(['m', 'x'].map(parseKey)).toEqual([{ type: 'mute' }, { type: 'mute' }]);
  });

  it('leaves every other key to the browser', () => {
    for (const key of ['g', 'y', 'p', 'c', 'R', 'U', 'G', 'Y', 'P', '.', '+', '-', '$', 'Enter', 'Escape', 'Tab']) {
      expect(parseKey(key), key).toBeNull();
    }
  });
});

describe('moveCursor', () => {
  // Channel strip with 4 fields, two unmuted Patterns, one muted, and so on.
  const shape = [4, 7, 7, 0, 0, 7, 0, 0, 0];
  const at = (row: number, col: number, level: Cursor['level'] = 'pattern'): Cursor => ({ level, row, col });
  const move = (cursor: Cursor, rows: number, cols: number, channel = 2) => moveCursor(cursor, channel, { type: 'move', rows, cols }, shape);

  it('moves between fields and rows', () => {
    expect(move(at(1, 2), 0, 1).cursor).toEqual(at(1, 3));
    expect(move(at(1, 2), 1, 0).cursor).toEqual(at(2, 2));
  });

  it('stops at the last field and the last row', () => {
    expect(move(at(1, 6), 0, 1).cursor).toEqual(at(1, 6));
    expect(move(at(8, 0), 1, 0).cursor).toEqual(at(8, 0));
    expect(move(at(0, 3), -1, 0).cursor).toEqual(at(0, 3));
  });

  it('pulls the column in when the new row is shorter', () => {
    expect(move(at(1, 6), -1, 0).cursor).toEqual(at(0, 3));
    expect(move(at(2, 5), 1, 0).cursor).toEqual(at(3, 0));
  });

  it('steps out to the Channel list when moving left past the first field', () => {
    expect(move(at(1, 0), 0, -1)).toEqual({ cursor: at(1, 0, 'channel'), channel: 2 });
    expect(move(at(1, 2), 0, -5).cursor.level).toBe('channel');
    expect(move(at(3, 0), 0, -1).cursor.level).toBe('channel');
  });

  it('steps through Channels with j and k at Channel level, without wrapping', () => {
    expect(move(at(1, 0, 'channel'), 1, 0)).toEqual({ cursor: at(1, 0, 'channel'), channel: 3 });
    expect(move(at(1, 0, 'channel'), -1, 0).channel).toBe(1);
    expect(move(at(1, 0, 'channel'), -5, 0).channel).toBe(0);
    expect(move(at(1, 0, 'channel'), Infinity, 0).channel).toBe(7);
  });

  it('steps back into the fields with l, on the row it left', () => {
    expect(move(at(2, 0, 'channel'), 0, 1)).toEqual({ cursor: at(2, 0), channel: 2 });
  });

  it('ignores h at Channel level', () => {
    expect(move(at(1, 0, 'channel'), 0, -1)).toEqual({ cursor: at(1, 0, 'channel'), channel: 2 });
  });
});
