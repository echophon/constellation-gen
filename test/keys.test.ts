import { describe, expect, it } from 'vitest';
import { moveCursor, parseKey, type Action, type Cursor } from '../src/app/keys';

/** Feeds keys one at a time and returns the Actions they produce. */
function type(...keys: string[]): Action[] {
  const actions: Action[] = [];
  let pending = '';
  for (const key of keys) {
    const ctrl = key.startsWith('^');
    const result = parseKey(pending, ctrl ? key.slice(1) : key, ctrl);
    pending = result.pending;
    if (result.action) actions.push(result.action);
  }
  return actions;
}

describe('parseKey', () => {
  it('moves with h j k l', () => {
    expect(type('h', 'j', 'k', 'l')).toEqual([
      { type: 'move', rows: 0, cols: -1 },
      { type: 'move', rows: 1, cols: 0 },
      { type: 'move', rows: -1, cols: 0 },
      { type: 'move', rows: 0, cols: 1 },
    ]);
  });

  it('raises with i and lowers with u', () => {
    expect(type('i', 'u')).toEqual([
      { type: 'bump', delta: 1 },
      { type: 'bump', delta: -1 },
    ]);
  });

  it('takes a count before any key', () => {
    expect(type('5', 'i')).toEqual([{ type: 'bump', delta: 5 }]);
    expect(type('2', '0', 'u')).toEqual([{ type: 'bump', delta: -20 }]);
    expect(type('3', 'j')).toEqual([{ type: 'move', rows: 3, cols: 0 }]);
  });

  it('reads 0 as "first field" unless a count is under way', () => {
    expect(type('0')).toEqual([{ type: 'move', rows: 0, cols: -Infinity }]);
    expect(type('1', '0', 'l')).toEqual([{ type: 'move', rows: 0, cols: 10 }]);
  });

  it('keeps the vim increments and + - as well', () => {
    expect(type('^a', '^x', '+', '-')).toEqual([
      { type: 'bump', delta: 1 },
      { type: 'bump', delta: -1 },
      { type: 'bump', delta: 1 },
      { type: 'bump', delta: -1 },
    ]);
  });

  it('goes to Channels with gt', () => {
    expect(type('g', 't')).toEqual([{ type: 'channelBy', delta: 1 }]);
    expect(type('g', 'T')).toEqual([{ type: 'channelBy', delta: -1 }]);
    expect(type('3', 'g', 't')).toEqual([{ type: 'channel', index: 2 }]);
    expect(type('9', 'g', 't')).toEqual([{ type: 'channel', index: 7 }]);
  });

  it('handles gg, G and a counted G', () => {
    expect(type('g', 'g')).toEqual([{ type: 'move', rows: -Infinity, cols: 0 }]);
    expect(type('G')).toEqual([{ type: 'move', rows: Infinity, cols: 0 }]);
    expect(type('3', 'G')).toEqual([{ type: 'goto', row: 3 }]);
  });

  it('copies with yy and pastes with p', () => {
    expect(type('y', 'y', 'p', 'Y', 'P').map((a) => a.type)).toEqual(['yankPattern', 'pastePattern', 'yankChannel', 'pasteChannel']);
  });

  it('undoes with U and redoes with ctrl-r', () => {
    expect(type('U', '^r').map((a) => a.type)).toEqual(['undo', 'redo']);
  });

  it('types a value with enter or c', () => {
    expect(type('Enter', 'c').map((a) => a.type)).toEqual(['type', 'type']);
  });

  it('drops a half-typed command on escape or an unknown key', () => {
    expect(parseKey('3g', 'Escape')).toEqual({ pending: '', handled: true });
    expect(parseKey('g', 'q')).toEqual({ pending: '', handled: false });
    expect(parseKey('', 'q').handled).toBe(false);
  });

  it('shows the pending count and prefix', () => {
    expect(parseKey('', '3').pending).toBe('3');
    expect(parseKey('3', 'g').pending).toBe('3g');
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
    expect(move(at(1, 0), 0, Infinity).cursor).toEqual(at(1, 6));
    expect(move(at(5, 3), -Infinity, 0).cursor).toEqual(at(0, 3));
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

  it('does not leave the fields on 0', () => {
    expect(move(at(1, 4), 0, -Infinity).cursor).toEqual(at(1, 0));
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

  it('goes to a numbered Pattern, or a numbered Channel at Channel level', () => {
    expect(moveCursor(at(1, 6), 2, { type: 'goto', row: 5 }, shape).cursor).toEqual(at(5, 6));
    expect(moveCursor(at(1, 6), 2, { type: 'goto', row: 3 }, shape).cursor).toEqual(at(3, 0));
    expect(moveCursor(at(1, 0, 'channel'), 2, { type: 'goto', row: 6 }, shape).channel).toBe(5);
  });
});
