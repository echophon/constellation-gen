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
import { Blips } from './audio';
import { GUTTER, ROMAN, SPAN, draw, handleAt, ink, layout, shapeOf, timeAt, type Geometry, type Handle } from './scope';
import { HORIZON, Timeline } from './timeline';

// The Bank under edit lives in memory, starting from the factory Bank.
const files = import.meta.glob('../../000/*.TXT', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const names = Object.keys(files).sort();
const bank: SaveSlot[] = names.map((k) => parseSaveSlot(files[k]!));
const slotName = (i: number) => names[i]!.slice(-6, -4);

let slotIndex = 0;
let channel = 0;
let timeline = new Timeline(bank[0]!);
let playing = false;
let stoppedAt = 0;
let blips: Blips | null = null;
let startedAt = 0;
let scheduledTo = 0;
const undo: { slot: number; text: string }[] = [];

const slot = () => bank[slotIndex]!;
const chan = () => slot().channels[channel]!;

function position(): number {
  if (!playing || !blips) return stoppedAt;
  return secondsToPulses(slot().clock, blips.now - startedAt) % HORIZON;
}

/** Keeps the playhead where it is when the tempo or the Save Slot changes under it. */
function reanchor(pos: number) {
  if (playing && blips) {
    startedAt = blips.now - pulsesToSeconds(slot().clock, pos);
    scheduledTo = pos;
  }
}

// ---------- editing ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const maxBurst = (p: Pattern) => (p.events > 0 ? Math.max(1, Math.floor(p.length / p.events)) : p.length);

/** Call once at the start of a gesture, so one undo step covers it. */
function checkpoint() {
  undo.push({ slot: slotIndex, text: serializeSaveSlot(slot()) });
  if (undo.length > 200) undo.shift();
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
let geo: Geometry;
/** Run after every edit to bring field values and ranges up to date without rebuilding them. */
let refreshers: (() => void)[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

/** A labelled number field. Scroll or type to change; click the label to randomise. */
function numberCell(name: string, get: () => number, range: () => [number, number], set: (v: number) => void) {
  const input = el('input', { type: 'number' });
  const commit = (v: number) => {
    const [lo, hi] = range();
    edit(() => set(clamp(v, lo, hi)));
  };
  input.onfocus = checkpoint;
  input.oninput = () => {
    if (input.value !== '' && !Number.isNaN(input.valueAsNumber)) commit(input.valueAsNumber);
  };
  input.onwheel = (e) => {
    e.preventDefault();
    if (document.activeElement !== input) checkpoint();
    commit(get() + (e.deltaY < 0 ? 1 : -1));
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
  return el('div', { className: 'cell' }, random, input);
}

function toggle(text: string, get: () => boolean, set: (on: boolean) => void, title = '') {
  const b = el('button', { textContent: text, title });
  b.onclick = () => {
    checkpoint();
    edit(() => set(!get()));
    build();
  };
  refreshers.push(() => b.classList.toggle('on', get()));
  return b;
}

function buildHeader() {
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
  const undoBtn = el('button', { textContent: 'undo', title: 'Cmd/Ctrl+Z' });
  undoBtn.onclick = undoLast;
  const save = el('button', { textContent: 'download', title: 'Download this Save Slot as NN.TXT' });
  save.onclick = () => {
    const a = el('a', { href: URL.createObjectURL(new Blob([serializeSaveSlot(slot())], { type: 'text/plain' })), download: `${slotName(slotIndex)}.TXT` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  header.replaceChildren(
    play,
    clockCell('bpm', 'bpm', 1, 300),
    clockCell('swing', 'swing', 50, 90),
    el('span', {}, 'Save Slot'),
    slots,
    el('span', { className: 'spacer' }),
    undoBtn,
    save,
  );
}

function buildControls() {
  const rows: HTMLElement[] = [];

  const logic = el('div', { className: 'seg' });
  for (const op of ['AND', 'OR', 'XOR'] as Logic[]) {
    const b = el('button', { textContent: op });
    b.onclick = () => {
      checkpoint();
      edit(() => (chan().logic = op));
    };
    refreshers.push(() => b.classList.toggle('on', chan().logic === op));
    logic.append(b);
  }
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
  strip.style.top = `${geo.stripY}px`;
  rows.push(strip);

  for (const row of geo.rows) {
    if (row.kind !== 'pattern' && row.kind !== 'muted') continue;
    const p = row.index;
    const pat = () => chan().patterns[p]!;
    const on = toggle(`P${p + 1}`, () => !pat().mute, (unmuted) => setPattern(pat(), 'mute', unmuted ? 0 : 1), 'Mute or unmute this Pattern');
    on.classList.add('pbtn');
    const line = el('div', {}, on);
    if (row.kind === 'pattern') {
      for (const [key, name, range] of PATTERN_FIELDS) {
        line.append(numberCell(name, () => pat()[key], () => range(pat()), (v) => setPattern(pat(), key, v)));
      }
    }
    line.style.top = `${row.y + (row.h - (row.kind === 'pattern' ? 40 : 20)) / 2}px`;
    rows.push(line);
  }
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
    blips ??= new Blips();
    void blips.ctx.resume();
    playing = true;
    reanchor(stoppedAt);
  } else {
    playing = false;
    stoppedAt = 0; // stop is also Reset
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

function select(c: number) {
  channel = c;
  build();
}

function undoLast() {
  const last = undo.pop();
  if (!last) return;
  const pos = position();
  slotIndex = last.slot;
  bank[slotIndex] = parseSaveSlot(last.text);
  timeline = new Timeline(slot());
  reanchor(pos);
  build();
}

function schedule() {
  if (!playing || !blips) return;
  const clock = slot().clock;
  const loop = pulsesToSeconds(clock, HORIZON);
  const elapsed = blips.now - startedAt;
  const base = Math.floor(elapsed / loop) * loop;
  const now = secondsToPulses(clock, elapsed - base);
  if (now < scheduledTo - 1) scheduledTo = 0; // wrapped past the horizon
  const from = Math.max(scheduledTo, now);
  const to = Math.min(HORIZON, secondsToPulses(clock, elapsed - base + 0.12));
  if (to <= from) return;
  for (let c = 0; c < 8; c++) {
    for (const t of timeline.rises(c, from, to)) blips.play(c, startedAt + base + pulsesToSeconds(clock, t));
  }
  scheduledTo = to;
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

const status = document.getElementById('status')!;

const pointer = (e: PointerEvent) => {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
};

canvas.onpointerdown = (e) => {
  const { x, y } = pointer(e);
  const row = geo.rows.find((r) => y >= r.y && y < r.y + r.h);
  if (row?.kind === 'overview') return select(row.index);
  const handle = handleAt(geo, slot(), channel, x, y);
  if (!handle) return;
  const pat = chan().patterns[handle.pattern]!;
  const { loop, delay, step } = shapeOf(slot(), channel, pat);
  const t = timeAt(geo, x);
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
      return set('rotate', (((d.start.rotate + Math.round((t - d.t0) / step)) % len) + len) % len);
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

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    return undoLast();
  }
  if ((e.target as HTMLElement).matches('input, textarea, [contenteditable]')) return;
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (/^[1-8]$/.test(e.key)) select(parseInt(e.key, 10) - 1);
});

function frame() {
  schedule();
  const pos = position();
  geo = { ...geo, page: Math.floor(pos / SPAN) * SPAN };
  draw(g, geo, { slot: slot(), timeline, channel, pos });
  requestAnimationFrame(frame);
}

window.addEventListener('resize', build);
build();
frame();
