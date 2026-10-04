// Keyboard commands. Pure functions: a key press becomes an Action and an
// Action moves the cursor, so both can be tested without a browser.

export type Action =
  | { type: 'move'; rows: number; cols: number }
  | { type: 'bump'; delta: number }
  | { type: 'mute' }
  | { type: 'channel'; index: number }
  | { type: 'slotBy'; delta: number }
  | { type: 'play' };

export const CHANNELS = 8;

/** The Action for a key, or null when the key means nothing here and the browser should have it. */
export function parseKey(key: string): Action | null {
  if (/^[1-8]$/.test(key)) return { type: 'channel', index: parseInt(key, 10) - 1 };
  switch (key) {
    case 'h': case 'ArrowLeft': return { type: 'move', rows: 0, cols: -1 };
    case 'l': case 'ArrowRight': return { type: 'move', rows: 0, cols: 1 };
    case 'j': case 'ArrowDown': return { type: 'move', rows: 1, cols: 0 };
    case 'k': case 'ArrowUp': return { type: 'move', rows: -1, cols: 0 };
    // u and i sit above j and k: left is down, right is up
    case 'i': return { type: 'bump', delta: 1 };
    case 'u': return { type: 'bump', delta: -1 };
    case 'm': case 'x': return { type: 'mute' };
    case '[': return { type: 'slotBy', delta: -1 };
    case ']': return { type: 'slotBy', delta: 1 };
    case ' ': return { type: 'play' };
  }
  return null;
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
  action: Extract<Action, { type: 'move' }>,
  shape: number[],
): { cursor: Cursor; channel: number } {
  const lastCol = (row: number) => Math.max(0, (shape[row] ?? 0) - 1);
  const lastRow = shape.length - 1;

  if (cursor.level === 'channel') {
    const next = clamp(channel + action.rows, 0, CHANNELS - 1);
    if (action.cols > 0) {
      return { cursor: { level: 'pattern', row: cursor.row, col: clamp(action.cols - 1, 0, lastCol(cursor.row)) }, channel: next };
    }
    return { cursor, channel: next };
  }

  const row = clamp(cursor.row + action.rows, 0, lastRow);
  const col = Math.min(cursor.col, lastCol(row));
  if (col + action.cols < 0) return { cursor: { level: 'channel', row, col: 0 }, channel };
  return { cursor: { level: 'pattern', row, col: clamp(col + action.cols, 0, lastCol(row)) }, channel };
}
