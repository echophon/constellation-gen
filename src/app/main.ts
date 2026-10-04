/// <reference types="vite/client" />
import {
  parseSaveSlot,
  pulsesToSeconds,
  secondsToPulses,
  serializeSaveSlot,
  type Channel,
  type Logic,
  type MainClock,
  type Pattern,
  type SaveSlot,
} from '../engine/index';
import { generateBank } from '../gen/bank';
import { evolve, evolveBare } from '../gen/evolve';
import type { Genotype } from '../gen/generate';
import { SIDECAR_NAME, channelHash, serializeSidecar } from '../gen/sidecar';
import { zip } from '../format/zip';
import { GENRES, genreById } from '../gen/genres';
import { nextWindow, type Queued } from './lookahead';
import { moveCursor, parseKey, type Action, type Cursor } from './keys';
import { buildVoiceEditor } from './voiceEditor';
import { Voices } from './voices';
import { GUTTER, ROMAN, SPAN, draw, handleAt, ink, layout, shapeOf, timeAt, type Geometry, type Handle } from './scope';
import { HORIZON, Timeline } from './timeline';

// The Bank under edit lives in memory, starting from the factory Bank.
const files = import.meta.glob('../../000/*.TXT', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const names = Object.keys(files).sort();
const bank: SaveSlot[] = names.map((k) => parseSaveSlot(files[k]!));
const slotName = (i: number) => names[i]!.slice(-6, -4);

let slotIndex = 0;
let channel = 0;
let genreId = GENRES[0]!.id;
/** The genre and seed the Bank was generated from, if it was. */
let generatedFrom = '';
let origin: { genre: string; seed: number } | null = null;
/** Genotypes of generated Save Slots, by the hash of their Channels, so that one survives undo and is dropped by an edit. */
const genotypes = new Map<string, Genotype>();
/** How far evolve may go, 0 to 1. */
let evolveAmount = 0.3;
let timeline = new Timeline(bank[0]!);
let playing = false;
let stoppedAt = 0;
let voices: Voices | null = null;
/** Whether each Channel's gate is open as of the last thing scheduled. */
const gate: boolean[] = new Array<boolean>(8).fill(false);
let startedAt = 0;
/** How far voices have been queued. */
const queued: Queued = { loop: 0, to: 0 };
const undo: { slot: number; text: string }[] = [];
const redo: { slot: number; text: string }[] = [];

const slot = () => bank[slotIndex]!;
const chan = () => slot().channels[channel]!;

function position(): number {
  if (!playing || !voices) return stoppedAt;
  return secondsToPulses(slot().clock, voices.now - startedAt) % HORIZON;
}

/** Keeps the playhead where it is when the tempo or the Save Slot changes under it. */
function reanchor(pos: number) {
  // queued.to is left alone: voices already queued for the next ~120 ms stay
  // as they are, and the change is heard from there on. Rewinding it would
  // queue the same voices again on every edit.
  if (playing && voices) {
    startedAt = voices.now - pulsesToSeconds(slot().clock, pos);
    queued.loop = 0;
  }
}

// ---------- editing ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const maxBurst = (p: Pattern) => (p.events > 0 ? Math.max(1, Math.floor(p.length / p.events)) : p.length);

/** Call once at the start of a gesture, so one undo step covers it. */
function checkpoint() {
  undo.push({ slot: slotIndex, text: serializeSaveSlot(slot()) });
  if (undo.length > 200) undo.shift();
  redo.length = 0;
}

/** Applies a change to the Save Slot under edit and re-renders. */
function edit(change: () => void) {
  const pos = position();
  change();
  timeline = new Timeline(slot());
  reanchor(pos);
  refresh();
}

function setPattern(p: Pattern, key: keyof Pattern, value: number) {
  switch (key) {
    case 'length': {
      const shrinking = value < p.length;
      p.length = clamp(value, 1, 999);
      // The module pulls Events and Rotate back to length - 1 when Length shrinks past them.
      if (shrinking && p.events > p.length - 1) p.events = Math.max(Math.min(p.events, 1), p.length - 1);
      p.rotate = Math.min(p.rotate, p.length - 1);
      break;
    }
    case 'events':
      p.events = clamp(value, 0, p.length);
      break;
    case 'rotate':
      p.rotate = clamp(value, 0, p.length - 1);
      break;
    case 'burst':
      p.burst = clamp(value, 1, 999);
      break;
    case 'ratchet':
    case 'divide':
      p[key] = clamp(value, 1, 255);
      break;
    case 'chance':
      p.chance = clamp(value, 0, 100);
      break;
    case 'mute':
      p.mute = value ? 1 : 0;
  }
  p.burst = Math.min(p.burst, maxBurst(p));
}

const PATTERN_FIELDS: [keyof Pattern, string, (p: Pattern) => [number, number]][] = [
  ['length', 'len', () => [1, 999]],
  ['events', 'events', (p) => [0, p.length]],
  ['rotate', 'rot', (p) => [0, p.length - 1]],
  ['burst', 'burst', (p) => [1, maxBurst(p)]],
  ['ratchet', 'ratchet', () => [1, 255]],
  ['divide', 'div', () => [1, 255]],
  ['chance', 'chance', () => [0, 100]],
];

const LOGICS: Logic[] = ['AND', 'OR', 'XOR'];

const CHANNEL_FIELDS: [keyof Channel, string, number, number][] = [
  ['width', 'width', 1, 100],
  ['ratchet', 'clock ×', 1, 255],
  ['divide', 'clock ÷', 1, 255],
  ['rotate', 'rotate', 0, 999],
];

// ---------- DOM ----------

const header = document.getElementById('header')!;
const controls = document.getElementById('controls')!;
const canvas = document.getElementById('scope') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const status = document.getElementById('status')!;
let geo: Geometry;
/** Run after every edit to bring field values and ranges up to date without rebuilding them. */
let refreshers: (() => void)[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

/** One stop for the keyboard cursor: a number field, a toggle, or the Logic selector. */
interface Cell {
  name: string;
  /** Present on number fields, which can also be typed into. */
  input?: HTMLInputElement;
  box: HTMLElement;
  get: () => number;
  range: () => [number, number];
  /** Sets the value, clamped to its range, as one edit. */
  commit: (v: number) => void;
}

/**
 * Row 0 is the Channel strip: Logic, flop, mute, then its number fields.
 * Rows 1-8 are Patterns: the mute toggle, then the number fields if unmuted.
 */
let grid: Cell[][] = [];
let cursor: Cursor = { level: 'pattern', row: 1, col: 1 };
/** Set while cells are being built, so each lands in the right row. */
let buildingRow: Cell[] | null = null;

/** A labelled number field. Scroll or type to change; click the label to randomise. */
function numberCell(name: string, get: () => number, range: () => [number, number], set: (v: number) => void) {
  const input = el('input', { type: 'number' });
  const commit = (v: number) => {
    const [lo, hi] = range();
    edit(() => set(clamp(v, lo, hi)));
  };
  const row = buildingRow;
  // Typing 16 passes through 1. Each keystroke is applied to the Save Slot as it
  // was when typing began, so the intermediate value cannot clamp its neighbours.
  let before: string | null = null;
  input.onfocus = () => {
    checkpoint();
    before = serializeSaveSlot(slot());
    if (row) {
      cursor = { level: 'pattern', row: grid.indexOf(row), col: row.findIndex((c) => c.input === input) };
      refresh();
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') input.blur();
  };
  input.oninput = () => {
    if (input.value === '' || Number.isNaN(input.valueAsNumber)) return;
    if (before) bank[slotIndex] = parseSaveSlot(before);
    commit(input.valueAsNumber);
  };
  input.onwheel = (e) => {
    e.preventDefault();
    if (document.activeElement !== input) checkpoint();
    commit(get() + (e.deltaY < 0 ? 1 : -1));
    before = serializeSaveSlot(slot());
  };
  const random = el('button', { textContent: name, title: `Randomise ${name}` });
  random.onclick = () => {
    checkpoint();
    const [lo, hi] = range();
    commit(lo + Math.floor(Math.random() * (hi - lo + 1)));
  };
  refreshers.push(() => {
    const [lo, hi] = range();
    input.min = String(lo);
    input.max = String(hi);
    if (document.activeElement !== input || input.valueAsNumber !== get()) input.value = String(get());
  });
  const box = el('div', { className: 'cell' }, random, input);
  row?.push({ name, input, box, get, range, commit });
  return box;
}

function toggle(text: string, get: () => boolean, set: (on: boolean) => void, title = '') {
  const b = el('button', { textContent: text, title });
  b.onclick = () => {
    checkpoint();
    edit(() => set(!get()));
    build();
  };
  refreshers.push(() => b.classList.toggle('on', get()));
  buildingRow?.push({
    name: text,
    box: b,
    get: () => (get() ? 1 : 0),
    range: () => [0, 1],
    commit: (v) => {
      edit(() => set(v > 0));
      build();
    },
  });
  return b;
}

function buildHeader() {
  buildingRow = null;
  const play = el('button', { textContent: 'play', title: 'Space' });
  play.onclick = togglePlay;
  refreshers.push(() => {
    play.textContent = playing ? 'stop' : 'play';
    play.classList.toggle('on', playing);
  });
  const clockCell = (key: keyof MainClock, name: string, lo: number, hi: number) =>
    numberCell(name, () => slot().clock[key], () => [lo, hi], (v) => (slot().clock[key] = v));
  const slots = el('div', { className: 'slots' });
  bank.forEach((_, i) => {
    const b = el('button', { textContent: slotName(i) });
    b.onclick = () => loadSlot(i);
    refreshers.push(() => b.classList.toggle('on', i === slotIndex));
    slots.append(b);
  });
  const genres = el('select', { title: 'Genre for generate' });
  for (const g of GENRES) genres.append(el('option', { value: g.id, textContent: g.name }));
  genres.value = genreId;
  genres.onchange = () => {
    genreId = genres.value;
    // Hand the keyboard back to the editor.
    genres.blur();
  };
  const generate = el('button', { textContent: 'generate', title: generatedFrom || 'Replace the Bank with 20 Save Slots in this genre' });
  generate.onclick = generateIntoBank;
  const amount = el('input', { type: 'range', min: '0', max: '1', step: '0.05', title: 'How far evolve may go' });
  amount.value = String(evolveAmount);
  amount.style.width = '60px';
  amount.oninput = () => (evolveAmount = amount.valueAsNumber);
  amount.onchange = () => amount.blur();
  const evolveBtn = el('button', { textContent: 'evolve', title: 'Vary this Save Slot, keeping what defines it' });
  evolveBtn.onclick = evolveSlot;
  const undoBtn = el('button', { textContent: 'undo', title: 'Cmd/Ctrl+Z' });
  undoBtn.onclick = undoLast;
  const save = el('button', { textContent: 'download', title: 'Download the Bank as a zip: unzip it and copy the folder to the card under a Bank number' });
  save.onclick = downloadBank;
  header.replaceChildren(
    play,
    clockCell('bpm', 'bpm', 1, 300),
    clockCell('swing', 'swing', 50, 90),
    el('span', {}, 'Save Slot'),
    slots,
    el('span', { className: 'spacer' }),
    genres,
    generate,
    evolveBtn,
    amount,
    undoBtn,
    save,
  );
}

function buildControls() {
  const rows: HTMLElement[] = [];
  grid = [[]];
  buildingRow = grid[0]!;

  const logic = el('div', { className: 'seg' });
  for (const op of LOGICS) {
    const b = el('button', { textContent: op });
    b.onclick = () => {
      checkpoint();
      edit(() => (chan().logic = op));
    };
    refreshers.push(() => b.classList.toggle('on', chan().logic === op));
    logic.append(b);
  }
  buildingRow.push({
    name: 'logic',
    box: logic,
    get: () => LOGICS.indexOf(chan().logic),
    range: () => [0, LOGICS.length - 1],
    commit: (v) => edit(() => (chan().logic = LOGICS[v]!)),
  });
  const title = el('span', { className: 'title', textContent: `Channel ${ROMAN[channel]}` });
  title.style.color = ink.event(channel);
  const strip = el(
    'div',
    {},
    title,
    logic,
    toggle('flop', () => !!chan().flop, (on) => (chan().flop = on ? 1 : 0)),
    toggle('mute', () => !!chan().mute, (on) => (chan().mute = on ? 1 : 0)),
    ...CHANNEL_FIELDS.map(([key, name, lo, hi]) =>
      numberCell(name, () => chan()[key] as number, () => [lo, hi], (v) => ((chan()[key] as number) = v)),
    ),
  );
  rows.push(strip);

  chan().patterns.forEach((_, p) => {
    buildingRow = [];
    grid.push(buildingRow);
    const pat = () => chan().patterns[p]!;
    const on = toggle(`P${p + 1}`, () => !pat().mute, (unmuted) => setPattern(pat(), 'mute', unmuted ? 0 : 1), 'Mute or unmute this Pattern');
    on.classList.add('pbtn');
    const line = el('div', {}, on);
    if (pat().mute) line.append(el('span', { className: 'note', textContent: 'muted' }));
    else {
      for (const [key, name, range] of PATTERN_FIELDS) {
        line.append(numberCell(name, () => pat()[key], () => range(pat()), (v) => setPattern(pat(), key, v)));
      }
    }
    rows.push(line);
  });
  buildingRow = null;
  controls.replaceChildren(...rows);
}

/** Rebuilds the controls. Needed when rows appear or disappear; plain value edits only refresh. */
function build() {
  refreshers = [];
  resize();
  buildHeader();
  buildControls();
  refresh();
}

function refresh() {
  for (const r of refreshers) r();
  cursor.row = Math.min(cursor.row, grid.length - 1);
  cursor.col = Math.min(cursor.col, Math.max(0, grid[cursor.row]!.length - 1));
  const inFields = cursor.level === 'pattern';
  grid.forEach((row, r) => row.forEach((cell, c) => cell.box.classList.toggle('cursor', inFields && r === cursor.row && c === cursor.col)));
  controls.querySelector('.title')?.classList.toggle('cursor', !inFields);
}

function resize() {
  const width = Math.max(900, window.innerWidth);
  geo = layout(slot(), channel, width, position());
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== width * ratio || canvas.height !== geo.height * ratio) {
    canvas.width = width * ratio;
    canvas.height = geo.height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${geo.height}px`;
  }
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
}

// ---------- actions ----------

function togglePlay() {
  if (!playing) {
    voices ??= new Voices();
    void voices.resume();
    playing = true;
    reanchor(stoppedAt);
    queued.to = stoppedAt;
  } else {
    playing = false;
    stoppedAt = 0; // stop is also Reset
    closeGates();
  }
  refresh();
}

function loadSlot(i: number) {
  // keeps position, like the module's in-sync load
  const pos = position();
  slotIndex = i;
  timeline = new Timeline(slot());
  reanchor(pos);
  build();
}

/** Replaces every Save Slot in the Bank. Undo does not reach across it. */
function generateIntoBank() {
  const genre = genreById(genreId);
  if (!genre || !confirm(`Replace all ${bank.length} Save Slots with ${genre.name}?`)) return;
  const seed = Math.floor(Math.random() * 0x100000000);
  const generated = generateBank(genre, seed);
  generated.slots.forEach(({ slot, genotype }, i) => {
    bank[i] = slot;
    genotypes.set(channelHash(slot), genotype);
  });
  origin = { genre: genre.id, seed };
  generatedFrom = `${genre.name}, seed ${seed}: npm run generate -- ${genre.id} --seed ${seed}`;
  undo.length = 0;
  redo.length = 0;
  loadSlot(slotIndex);
}

/** Downloads every Save Slot of the Bank, and its sidecar if it was generated, as one zip. */
function downloadBank() {
  const entries = bank.map((s, i) => ({ name: `${slotName(i)}.TXT`, text: serializeSaveSlot(s) }));
  if (origin) {
    // A Save Slot edited since it was generated or evolved has no Genotype any more.
    const slots = bank.map((s) => {
      const hash = channelHash(s);
      const genotype = genotypes.get(hash);
      return genotype ? { genotype, hash } : null;
    });
    entries.push({ name: SIDECAR_NAME, text: serializeSidecar({ version: 1, ...origin, slots }) });
  }
  const url = URL.createObjectURL(new Blob([zip(entries) as BlobPart], { type: 'application/zip' }));
  el('a', { href: url, download: origin ? `bank-${origin.genre}.zip` : 'bank.zip' }).click();
  URL.revokeObjectURL(url);
}

/** Replaces the Save Slot under edit with a variation of it; one undo step. */
function evolveSlot() {
  const options = { seed: Math.floor(Math.random() * 0x100000000), amount: evolveAmount };
  const genotype = genotypes.get(channelHash(slot()));
  const genre = genotype && genreById(genotype.genre);
  checkpoint();
  edit(() => {
    if (genotype && genre) {
      const child = evolve(genre, { slot: slot(), genotype }, options);
      genotypes.set(channelHash(child.slot), child.genotype);
      bank[slotIndex] = child.slot;
    } else {
      bank[slotIndex] = evolveBare(slot(), options).slot;
    }
  });
  build();
}

function select(c: number) {
  channel = c;
  build();
}

function restore(from: typeof undo, to: typeof undo) {
  const last = from.pop();
  if (!last) return;
  const pos = position();
  to.push({ slot: last.slot, text: serializeSaveSlot(bank[last.slot]!) });
  slotIndex = last.slot;
  bank[slotIndex] = parseSaveSlot(last.text);
  timeline = new Timeline(slot());
  reanchor(pos);
  build();
}
const undoLast = () => restore(undo, redo);
const redoLast = () => restore(redo, undo);

function schedule() {
  if (!playing || !voices) return;
  const clock = slot().clock;
  const next = nextWindow(clock, voices.now - startedAt, HORIZON, queued);
  if (!next) return;
  const { from, to, base } = next;
  const at = (t: number) => startedAt + base + pulsesToSeconds(clock, t);
  for (let c = 0; c < 8; c++) {
    // An edit, a Save Slot switch or the loop wrapping can leave a gate open
    // that the timeline now says is closed, or the reverse. Settle it first.
    const expected = timeline.levelBefore(c, from);
    if (expected !== gate[c]) {
      voices.gate(c, expected, at(from));
      gate[c] = expected;
    }
    for (const e of timeline.edges(c, from, to)) {
      voices.gate(c, e.high, at(e.t));
      gate[c] = e.high;
    }
  }
}

function closeGates() {
  if (!voices) return;
  for (let c = 0; c < 8; c++) {
    if (gate[c]) voices.gate(c, false, voices.now);
    gate[c] = false;
  }
}

// ---------- pointer: drag on a lane ----------

// Dragging the body of a lane changes a different parameter depending on the
// modifier held and whether the drag turns out horizontal or vertical.
type BodyParam = 'rotate' | 'events' | 'burst' | 'ratchet' | 'chance';
const BODY: Record<'plain' | 'shift' | 'alt', { h: BodyParam; v: BodyParam }> = {
  plain: { h: 'rotate', v: 'events' },
  shift: { h: 'burst', v: 'ratchet' },
  alt: { h: 'chance', v: 'chance' },
};

let drag: {
  handle: NonNullable<Handle>;
  x0: number;
  y0: number;
  t0: number;
  anchor: number;
  mod: keyof typeof BODY;
  param: BodyParam | null;
  start: Pattern;
} | null = null;

const pointer = (e: PointerEvent) => {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
};

canvas.onpointerdown = (e) => {
  const { x, y } = pointer(e);
  const row = geo.rows.find((r) => y >= r.y && y < r.y + r.h);
  if (row?.kind === 'overview') {
    cursor = { ...cursor, level: 'channel' };
    return select(row.index);
  }
  const handle = handleAt(geo, slot(), channel, x, y);
  if (!handle) return;
  const pat = chan().patterns[handle.pattern]!;
  const { loop, delay, step } = shapeOf(slot(), channel, pat);
  const t = timeAt(geo, x);
  cursor = { level: 'pattern', row: handle.pattern + 1, col: cursor.col };
  checkpoint();
  canvas.setPointerCapture(e.pointerId);
  const anchor =
    handle.kind === 'length'
      ? delay + (Math.round((t - delay) / loop) - 1) * loop
      : delay + Math.floor((t - delay) / step) * step;
  drag = { handle, x0: x, y0: y, t0: t, anchor, mod: e.altKey ? 'alt' : e.shiftKey ? 'shift' : 'plain', param: null, start: { ...pat } };
};

canvas.onpointermove = (e) => {
  const { x, y } = pointer(e);
  if (!drag) {
    const h = handleAt(geo, slot(), channel, x, y);
    canvas.style.cursor = !h ? 'default' : h.kind === 'body' ? 'grab' : 'ew-resize';
    return;
  }
  const d = drag;
  const pat = chan().patterns[d.handle.pattern]!;
  const { step, channelStep, len } = shapeOf(slot(), channel, pat);
  const t = timeAt(geo, x);
  const set = (key: keyof Pattern, next: number) => {
    if (next !== pat[key]) edit(() => setPattern(pat, key, next));
    status.textContent = `P${d.handle.pattern + 1} ${key} ${pat[key]}`;
  };

  if (d.handle.kind === 'length') return set('length', clamp((t - d.anchor) / step, 1, 999));
  if (d.handle.kind === 'divide') return set('divide', clamp((t - d.anchor) / channelStep, 1, 255));

  const dx = x - d.x0;
  const dy = d.y0 - y; // up is more
  if (!d.param) {
    if (Math.hypot(dx, dy) < 5) return;
    d.param = BODY[d.mod][Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'];
  }
  const stepPx = Math.max(12, ((geo.right - GUTTER) / SPAN) * step);
  switch (d.param) {
    case 'rotate':
      return set('rotate', clamp(d.start.rotate + (t - d.t0) / step, 0, len - 1));
    case 'events':
      return set('events', clamp(d.start.events + dy / 8, 0, pat.length));
    case 'burst':
      return set('burst', clamp(d.start.burst + dx / stepPx, 1, 999));
    case 'ratchet':
      return set('ratchet', clamp(d.start.ratchet + dy / 10, 1, 255));
    case 'chance':
      return set('chance', clamp(d.start.chance + (Math.abs(dx) > Math.abs(dy) ? dx : dy) / 2, 0, 100));
  }
};

canvas.onpointerup = canvas.onpointercancel = () => {
  drag = null;
  status.textContent = '';
};

// ---------- keyboard: h j k l over the grid of fields ----------

const cell = () => (cursor.level === 'pattern' ? grid[cursor.row]?.[cursor.col] : undefined);
const cursorPattern = () => (cursor.level === 'pattern' && cursor.row > 0 ? chan().patterns[cursor.row - 1]! : null);
const wrap = (v: number, n: number) => ((v % n) + n) % n;

function bump(delta: number) {
  const c = cell();
  if (!c) return;
  const [lo, hi] = c.range();
  const next = clamp(c.get() + delta, lo, hi);
  if (next === c.get()) return;
  checkpoint();
  c.commit(next);
}

/** What Cmd/Ctrl+C took: a Pattern from a Pattern row, otherwise the whole Channel. */
let copied: { pattern: Pattern } | { channel: string } | null = null;

function copy() {
  const pat = cursorPattern();
  copied = pat ? { pattern: { ...pat } } : { channel: JSON.stringify(chan()) };
  status.textContent = pat ? `copied P${cursor.row}` : `copied Channel ${ROMAN[channel]}`;
}

/** A copied Pattern goes onto the Pattern under the cursor; a copied Channel replaces the selected Channel. */
function paste() {
  if (!copied) return;
  if ('pattern' in copied) {
    const pat = cursorPattern();
    if (!pat) {
      status.textContent = 'move to a Pattern row to paste a Pattern';
      return;
    }
    const from = copied.pattern;
    checkpoint();
    edit(() => Object.assign(pat, from));
  } else {
    const from = JSON.parse(copied.channel) as Channel;
    checkpoint();
    edit(() => (slot().channels[channel] = from));
  }
  status.textContent = '';
  build();
}

function run(action: Action) {
  switch (action.type) {
    case 'move': {
      const next = moveCursor(cursor, channel, action, grid.map((row) => row.length));
      cursor = next.cursor;
      if (next.channel !== channel) select(next.channel);
      return;
    }
    case 'bump':
      return bump(action.delta);
    case 'mute': {
      // On a Pattern row this mutes the Pattern; on the Channel list or strip, the Channel.
      const pat = cursorPattern();
      checkpoint();
      edit(() => (pat ? setPattern(pat, 'mute', pat.mute ? 0 : 1) : (chan().mute = chan().mute ? 0 : 1)));
      return build();
    }
    case 'channel':
      return select(action.index);
    case 'slotBy':
      return loadSlot(wrap(slotIndex + action.delta, bank.length));
    case 'play':
      return togglePlay();
  }
}

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    return e.shiftKey ? redoLast() : undoLast();
  }
  const inField = (e.target as HTMLElement).matches('input, select, textarea, [contenteditable]');
  // Copying selected text and pasting into a field stay the browser's.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !inField && (e.key === 'c' || e.key === 'v')) {
    if (e.key === 'c' && !window.getSelection()?.isCollapsed) return;
    e.preventDefault();
    return e.key === 'c' ? copy() : paste();
  }
  if (e.metaKey || e.ctrlKey || e.altKey || inField) return;
  const action = parseKey(e.key);
  if (!action) return;
  e.preventDefault();
  run(action);
  refresh();
});

function frame() {
  schedule();
  const pos = position();
  geo = { ...geo, page: Math.floor(pos / SPAN) * SPAN };
  draw(g, geo, { slot: slot(), timeline, channel, pos, focus: cursor });
  requestAnimationFrame(frame);
}

window.addEventListener('resize', build);
buildVoiceEditor(document.getElementById('voice-editor')!);
build();
frame();
