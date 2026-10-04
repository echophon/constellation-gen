import {
  combinedEdges,
  euclid,
  patternEvents,
  patternStepKinds,
  type Interval,
  type Pattern,
  type SaveSlot,
} from '../engine/index';
import { SEED, type Timeline } from './timeline';

// The Scope: linear shared time. Every Channel's Output Signal on top, then the
// selected Channel opened into Pattern lanes, its Logic result and its output.

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
export const SPAN = 64; // pulses per page
export const GUTTER = 462; // left of the time axis: controls and dials
const LANE = 58;
const MUTED_LANE = 22;
const OVERVIEW = 22;
const STRIP = 12; // step cells and numbers under the Pulses

// Every indicator keeps its Channel's hue; saturation and lightness tell them apart.
const tone = (c: number, s: number, l: number, a = 1) => `hsl(${(200 + c * 45) % 360} ${s}% ${l}% / ${a})`;
export const ink = {
  event: (c: number, a = 1) => tone(c, 80, 62, a),
  burst: (c: number, a = 1) => tone(c, 55, 38, a),
  length: (c: number, a = 1) => tone(c, 35, 93, a),
  rotate: (c: number, a = 1) => tone(c, 100, 82, a),
  divide: (c: number, a = 1) => tone(c, 30, 50, a),
  logic: (c: number, a = 1) => tone(c, 95, 76, a),
};

export interface Row {
  kind: 'overview' | 'pattern' | 'muted' | 'logic' | 'out';
  index: number;
  y: number;
  h: number;
}

export interface Geometry {
  width: number;
  height: number;
  right: number;
  page: number;
  /** Where the Channel settings strip sits, for the DOM controls. */
  stripY: number;
  rows: Row[];
}

export function layout(slot: SaveSlot, channel: number, width: number, pos: number): Geometry {
  const rows: Row[] = [];
  let y = 8;
  for (let c = 0; c < 8; c++) {
    rows.push({ kind: 'overview', index: c, y, h: OVERVIEW });
    y += OVERVIEW;
  }
  y += 12;
  const stripY = y;
  y += 52;
  slot.channels[channel]!.patterns.forEach((pat, p) => {
    const h = pat.mute ? MUTED_LANE : LANE;
    rows.push({ kind: pat.mute ? 'muted' : 'pattern', index: p, y, h });
    y += h;
  });
  y += 8;
  rows.push({ kind: 'logic', index: 0, y, h: 30 });
  y += 36;
  rows.push({ kind: 'out', index: 0, y, h: 30 });
  y += 44;
  return { width, height: y, right: width - 16, page: Math.floor(pos / SPAN) * SPAN, stripY, rows };
}

export const xOf = (geo: Geometry, t: number) => GUTTER + ((t - geo.page) / SPAN) * (geo.right - GUTTER);
export const timeAt = (geo: Geometry, x: number) => geo.page + ((x - GUTTER) / (geo.right - GUTTER)) * SPAN;

export interface PatternShape {
  len: number;
  rot: number;
  div: number;
  /** Channel Clock step, in pulses. */
  channelStep: number;
  /** Pattern Clock step, in pulses. */
  step: number;
  loop: number;
  delay: number;
}

export function shapeOf(slot: SaveSlot, channel: number, pat: Pattern): PatternShape {
  const ch = slot.channels[channel]!;
  const len = Math.max(1, pat.length);
  const div = (pat.divide & 255) || 1;
  const channelStep = (ch.divide || 1) / (ch.ratchet || 1);
  const step = channelStep * div;
  return { len, rot: ((pat.rotate % len) + len) % len, div, channelStep, step, loop: len * step, delay: (ch.rotate / 100) * channelStep };
}

export interface View {
  slot: SaveSlot;
  timeline: Timeline;
  channel: number;
  pos: number;
}

export function draw(g: CanvasRenderingContext2D, geo: Geometry, view: View): void {
  const { slot, timeline, channel, pos } = view;
  const { page, right } = geo;
  const ch = slot.channels[channel]!;
  const x = (t: number) => xOf(geo, t);

  g.clearRect(0, 0, geo.width, geo.height);
  const label = (s: string, lx: number, y: number, color: string, align: CanvasTextAlign = 'left', size = 12) => {
    g.fillStyle = color;
    g.textAlign = align;
    g.font = `${size}px ui-monospace, Menlo, monospace`;
    g.fillText(s, lx, y);
  };
  const lane = (ivs: Interval[], y: number, h: number, color: string) => {
    g.fillStyle = color;
    for (const iv of ivs) {
      const a = Math.max(x(iv.start), GUTTER);
      const b = Math.min(x(iv.end), right);
      if (b > a - 1.5) g.fillRect(a, y, Math.max(1.5, b - a), h);
    }
  };
  const grid = (y: number, h: number) => {
    for (let p = 0; p <= SPAN; p++) {
      g.fillStyle = p % 16 === 0 ? '#3a4458' : p % 4 === 0 ? '#232a38' : '#161b25';
      g.fillRect(x(page + p), y, 1, h);
    }
  };
  const ring = (cx: number, cy: number, r: number, a: number, b: number, width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2 + a * 2 * Math.PI, -Math.PI / 2 + b * 2 * Math.PI);
    g.stroke();
  };

  const first = geo.rows[0]!;
  const lanes = geo.rows.filter((r) => r.kind !== 'overview');
  grid(first.y, OVERVIEW * 8);
  grid(lanes[0]!.y, lanes[lanes.length - 1]!.y + 30 - lanes[0]!.y);

  for (const row of geo.rows) {
    const { y, h } = row;

    if (row.kind === 'overview') {
      const c = row.index;
      const muted = !!slot.channels[c]!.mute;
      if (c === channel) {
        g.fillStyle = '#ffffff12';
        g.fillRect(0, y, geo.width, h);
      }
      label(`${ROMAN[c]}${muted ? '  muted' : ''}`, GUTTER - 12, y + h * 0.7, muted ? '#4a556b' : ink.event(c), 'right');
      lane(timeline.intervals(c, page, page + SPAN), y + 4, h - 8, ink.event(c));
      continue;
    }

    if (row.kind === 'logic') {
      label(ch.logic, GUTTER - 12, y + h * 0.65, ink.logic(channel), 'right');
      const { initial, edges } = combinedEdges(slot, channel, page, page + SPAN, { seed: SEED });
      const ivs: Interval[] = [];
      let start: number | null = initial ? page : null;
      for (const e of edges) {
        if (e.high && start == null) start = e.t;
        else if (!e.high && start != null) {
          ivs.push({ start, end: e.t });
          start = null;
        }
      }
      if (start != null) ivs.push({ start, end: page + SPAN });
      lane(ivs, y + 3, h - 6, ink.logic(channel));
      continue;
    }

    if (row.kind === 'out') {
      label(ch.mute ? 'muted' : ch.flop ? 'flop' : 'out', GUTTER - 12, y + h * 0.65, ink.event(channel), 'right');
      lane(timeline.intervals(channel, page, page + SPAN), y + 3, h - 6, ink.event(channel));
      continue;
    }

    const pat = ch.patterns[row.index]!;
    if (row.kind === 'muted') {
      g.fillStyle = '#2a3140';
      for (const e of patternEvents(slot, channel, row.index, page, page + SPAN, { seed: SEED })) {
        const a = Math.max(x(e.start), GUTTER);
        if (a < right) g.fillRect(a, y + 7, Math.max(1.5, Math.min(x(e.end), right) - a), h - 14);
      }
      continue;
    }

    // ---- an unmuted Pattern lane ----
    const { len, rot, div, step, loop, delay } = shapeOf(slot, channel, pat);
    const stepPx = ((right - GUTTER) / SPAN) * step;
    const top = y + 9;
    const full = h - 9 - STRIP - 4;
    const stripY = y + h - STRIP;
    const loops: number[] = [];
    for (let n = Math.floor((page - delay) / loop); delay + n * loop < page + SPAN; n++) loops.push(delay + n * loop);

    // Divide: every step is a cell in the strip
    for (let k = Math.floor((page - delay) / step); delay + k * step < page + SPAN; k++) {
      const t = delay + k * step;
      const a = Math.max(x(t), GUTTER);
      const b = Math.min(x(t + step), right);
      if (b <= a) continue;
      g.fillStyle = div > 1 ? ink.divide(channel, k % 2 ? 0.25 : 0.5) : k % 2 ? '#ffffff05' : '#ffffff10';
      g.fillRect(a, stripY, b - a, STRIP - 1);
      if (div > 1 && t >= page) {
        g.fillStyle = ink.divide(channel);
        g.fillRect(x(t), stripY, 1.5, STRIP - 1);
      }
    }

    // Length: a bracket at each loop start
    g.fillStyle = ink.length(channel);
    for (const s of loops) {
      if (s < page) continue;
      g.fillRect(x(s), y + 1, 1.5, h - 2);
      g.fillRect(x(s), y + 1, 6, 1.5);
    }

    // Rotate: ghosts of the unrotated Events, and an arrow carrying the first to where it landed
    if (rot > 0) {
      const core = euclid(len, Math.min(pat.events, len));
      const ghostW = Math.max(3, (stepPx / ((pat.ratchet & 255) || 1)) * (ch.width / 100));
      for (const s of loops) {
        let arrow = true;
        core.forEach((on, i) => {
          const t = s + i * step;
          if (!on || t < page || t >= page + SPAN) return;
          g.strokeStyle = ink.rotate(channel, 0.6);
          g.lineWidth = 1;
          g.setLineDash([2, 2]);
          g.strokeRect(x(t) + 0.5, top + 0.5, ghostW - 1, full - 1);
          g.setLineDash([]);
          if (arrow) {
            const o = Math.min(x(t + rot * step), right);
            g.fillStyle = ink.rotate(channel);
            g.fillRect(x(t) + 2, y + 3, o - x(t) - 2, 1.5);
            g.beginPath();
            g.moveTo(o, y);
            g.lineTo(o, y + 7);
            g.lineTo(o + 5, y + 3.5);
            g.fill();
            arrow = false;
          }
        });
      }
    }

    // Step numbers follow the core loop, so "1" sits wherever Rotate moved the start to
    const every = stepPx >= 13 ? 1 : stepPx >= 6.5 ? 2 : stepPx >= 3.3 ? 4 : 8;
    for (const s of loops) {
      for (let k = 0; k < len; k++) {
        const t = s + k * step;
        if (t < page || t >= page + SPAN) continue;
        const num = ((((k - rot) % len) + len) % len) + 1;
        if (num !== 1 && (num - 1) % every !== 0) continue;
        label(String(num), x(t) + 3, y + h - 3, num === 1 ? ink.rotate(channel) : '#6b7790', 'left', 9);
      }
    }

    // Events: core full height, Ratchet repeats short, Burst repeats darker with a tail, Chance-blocked hollow
    for (const e of patternEvents(slot, channel, row.index, page, page + SPAN, { seed: SEED })) {
      if (e.end <= page || e.start >= page + SPAN) continue;
      const a = Math.max(x(e.start), GUTTER);
      const w = Math.max(1.5, Math.min(x(e.end), right) - a);
      const eh = e.ratchet === 0 ? full : full * 0.5;
      const ey = top + full - eh;
      if (!e.burst && e.ratchet === 0 && pat.burst > 1 && e.start >= page) {
        g.fillStyle = ink.burst(channel);
        g.fillRect(a, stripY - 3, Math.min(x(e.start + Math.min(pat.burst, len) * step), right) - a, 2);
      }
      if (e.passed) {
        g.fillStyle = e.burst ? ink.burst(channel) : ink.event(channel);
        g.fillRect(a, ey, w, eh);
      } else {
        g.strokeStyle = ink.event(channel, 0.6);
        g.lineWidth = 1;
        g.strokeRect(a + 0.5, ey + 0.5, Math.max(1, w - 1), eh - 1);
      }
    }

    // Dial: one loop. Dots are steps, the arc is Rotate, the hand is the playhead.
    const cx = GUTTER - 28;
    const cy = y + h / 2;
    const r = h / 2 - 8;
    ring(cx, cy, r, 0, 1, 1, '#3a4458');
    if (rot > 0) ring(cx, cy, r + 3.5, 0, rot / len, 2, ink.rotate(channel));
    if (len <= 64) {
      patternStepKinds(pat).forEach((kind, i) => {
        const an = -Math.PI / 2 + (i / len) * 2 * Math.PI;
        g.fillStyle = kind === 'event' ? ink.event(channel) : kind === 'burst' ? ink.burst(channel) : '#4a556b';
        g.beginPath();
        g.arc(cx + Math.cos(an) * r, cy + Math.sin(an) * r, kind ? 2.4 : 1, 0, 7);
        g.fill();
      });
    }
    const hand = -Math.PI / 2 + (((((pos - delay) % loop) + loop) % loop) / loop) * 2 * Math.PI;
    g.strokeStyle = '#fff';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(hand) * r, cy + Math.sin(hand) * r);
    g.stroke();
  }

  g.fillStyle = '#fff';
  g.fillRect(x(pos), 0, 1.5, geo.height);
}

export type Handle = { kind: 'body' | 'length' | 'divide'; pattern: number } | null;

/** Which drag a pointer position would start: the loop bracket for Length, the step strip for Divide, otherwise the lane body. */
export function handleAt(geo: Geometry, slot: SaveSlot, channel: number, px: number, py: number): Handle {
  if (px < GUTTER || px > geo.right) return null;
  const row = geo.rows.find((r) => r.kind === 'pattern' && py >= r.y && py < r.y + r.h);
  if (!row) return null;
  const pat = slot.channels[channel]!.patterns[row.index]!;
  const { loop, delay } = shapeOf(slot, channel, pat);
  if (py >= row.y + row.h - STRIP) return { kind: 'divide', pattern: row.index };
  const t = timeAt(geo, px);
  const nearest = delay + Math.round((t - delay) / loop) * loop;
  if (nearest - loop >= geo.page && Math.abs(xOf(geo, nearest) - px) < 6) return { kind: 'length', pattern: row.index };
  return { kind: 'body', pattern: row.index };
}
