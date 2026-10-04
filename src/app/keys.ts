// Keyboard commands, loosely after vim. Pure functions: key presses become
// Actions and Actions move the cursor, so both can be tested without a browser.

export type Action =
  | { type: 'move'; rows: number; cols: number }
  | { type: 'goto'; row: number }
  | { type: 'bump'; delta: number }
  | { type: 'repeat' }
  | { type: 'type' }
  | { type: 'random' }
  | { type: 'mute' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'yankPattern' }
  | { type: 'pastePattern' }
  | { type: 'yankChannel' }
  | { type: 'pasteChannel' }
  | { type: 'channel'; index: number }
  | { type: 'channelBy'; delta: number }
  | { type: 'logic' }
  | { type: 'flop' }
  | { type: 'slotBy'; delta: number }
  | { type: 'play' };

export interface KeyResult {
  /** Keys still waiting for the rest of a command: a count, or g / y. */
  pending: string;
  action?: Action;
  /** False when the key means nothing here and the browser should have it. */
  handled: boolean;
}

export const CHANNELS = 8;
const END = Number.POSITIVE_INFINITY;

export function parseKey(pending: string, key: string, ctrl = false): KeyResult {
  const digits = /^\d+/.exec(pending)?.[0] ?? '';
  const prefix = pending.slice(digits.length);
  const counted = digits !== '';
  const n = counted ? parseInt(digits, 10) : 1;
  const done = (action: Action): KeyResult => ({ pending: '', action, handled: true });
  const wait = (next: string): KeyResult => ({ pending: next, handled: true });
  const miss: KeyResult = { pending: '', handled: false };

  if (key === 'Escape') return wait('');

  if (ctrl) {
    if (key === 'a') return done({ type: 'bump', delta: n });
    if (key === 'x') return done({ type: 'bump', delta: -n });
    if (key === 'r') return done({ type: 'redo' });
    return miss;
  }

  if (prefix === 'g') {
    switch (key) {
      case 'g': return done({ type: 'move', rows: -END, cols: 0 });
      case 't': return done(counted ? { type: 'channel', index: Math.min(CHANNELS, Math.max(1, n)) - 1 } : { type: 'channelBy', delta: 1 });
      case 'T': return done({ type: 'channelBy', delta: -n });
      case 'l': return done({ type: 'logic' });
      case 'f': return done({ type: 'flop' });
    }
    return miss;
  }
  if (prefix === 'y') return key === 'y' ? done({ type: 'yankPattern' }) : miss;

  if (/^[1-9]$/.test(key) || (key === '0' && counted)) return wait(digits + key);
  if (key === 'g' || key === 'y') return wait(digits + key);

  switch (key) {
    case 'h': return done({ type: 'move', rows: 0, cols: -n });
    case 'l': return done({ type: 'move', rows: 0, cols: n });
    case 'j': return done({ type: 'move', rows: n, cols: 0 });
    case 'k': return done({ type: 'move', rows: -n, cols: 0 });
    case '0': return done({ type: 'move', rows: 0, cols: -END });
    case '$': return done({ type: 'move', rows: 0, cols: END });
    case 'G': return done(counted ? { type: 'goto', row: n } : { type: 'move', rows: END, cols: 0 });
    // u and i sit above j and k: left is down, right is up
    case 'i': case '+': case '=': return done({ type: 'bump', delta: n });
    case 'u': case '-': return done({ type: 'bump', delta: -n });
    case '.': return done({ type: 'repeat' });
    case 'U': return done({ type: 'undo' });
    case 'c': case 'Enter': return done({ type: 'type' });
    case 'R': return done({ type: 'random' });
    case 'm': case 'x': return done({ type: 'mute' });
    case 'p': return done({ type: 'pastePattern' });
    case 'Y': return done({ type: 'yankChannel' });
    case 'P': return done({ type: 'pasteChannel' });
    case '[': return done({ type: 'slotBy', delta: -n });
    case ']': return done({ type: 'slotBy', delta: n });
    case ' ': return done({ type: 'play' });
  }
  return miss;
}

/**
 * Where the keyboard is. At 'channel' level j and k step through Channels; at
 * 'pattern' level the cursor is on a field: row 0 is the Channel strip, rows
 * 1-8 are Patterns.
 */
export interface Cursor {
  level: 'channel' | 'pattern';
  row: number;
  col: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Applies a move. `shape` is the number of fields in each row. Moving left
 * past the first field steps out to the Channel list; moving right from the
 * Channel list steps back in.
 */
export function moveCursor(
  cursor: Cursor,
  channel: number,
  action: Extract<Action, { type: 'move' | 'goto' }>,
  shape: number[],
): { cursor: Cursor; channel: number } {
  const lastCol = (row: number) => Math.max(0, (shape[row] ?? 0) - 1);
  const lastRow = shape.length - 1;

  if (cursor.level === 'channel') {
    if (action.type === 'goto') return { cursor, channel: clamp(action.row - 1, 0, CHANNELS - 1) };
    const next = clamp(channel + action.rows, 0, CHANNELS - 1);
    if (action.cols > 0) {
      return { cursor: { level: 'pattern', row: cursor.row, col: clamp(action.cols - 1, 0, lastCol(cursor.row)) }, channel: next };
    }
    return { cursor, channel: next };
  }

  if (action.type === 'goto') {
    const row = clamp(action.row, 0, lastRow);
    return { cursor: { level: 'pattern', row, col: Math.min(cursor.col, lastCol(row)) }, channel };
  }
  const row = clamp(cursor.row + action.rows, 0, lastRow);
  const col = Math.min(cursor.col, lastCol(row));
  if (action.cols === -END) return { cursor: { level: 'pattern', row, col: 0 }, channel };
  if (col + action.cols < 0) return { cursor: { level: 'channel', row, col: 0 }, channel };
  return { cursor: { level: 'pattern', row, col: clamp(col + action.cols, 0, lastCol(row)) }, channel };
}
