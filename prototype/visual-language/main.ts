// PROTOTYPE, throwaway. Two variants of the main view, switchable via ?variant=A|C,
// answering "how are Patterns, Pulses and Logic drawn?" (ticket #7).
// Real factory Save Slots from 000/, real engine, no editing, no persistence.

import {
  ChannelRenderer,
  combinedEdges,
  parseSaveSlot,
  patternEvents,
  euclid,
  patternPulses,
  patternStepKinds,
  pulsesToSeconds,
  secondsToPulses,
  type Edge,
  type Interval,
  type PatternEvent,
  type SaveSlot,
} from '../../src/engine/index';

const files = import.meta.glob('../../000/*.TXT', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const slots = Object.keys(files)
  .sort()
  .map((k) => ({ name: k.slice(-6, -4), slot: parseSaveSlot(files[k]!) }));

const HORIZON = 1024; // pulses rendered up front; playback loops here
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const hue = (c: number) => `hsl(${(200 + c * 45) % 360} 80% 62%)`;
// Every indicator keeps its Channel's hue; saturation and lightness tell them apart.
const tone = (c: number, s: number, l: number, a = 1) => `hsl(${(200 + c * 45) % 360} ${s}% ${l}% / ${a})`;
const ink = {
  event: (c: number, a = 1) => tone(c, 80, 62, a),
  burst: (c: number, a = 1) => tone(c, 55, 38, a),
  length: (c: number, a = 1) => tone(c, 35, 93, a),
  rotate: (c: number, a = 1) => tone(c, 100, 82, a),
  divide: (c: number, a = 1) => tone(c, 30, 50, a),
  logic: (c: number, a = 1) => tone(c, 95, 76, a),
};
const dim = (c: number, a: number) => `hsl(${(200 + c * 45) % 360} 70% 60% / ${a})`;

interface Rendered {
  slot: SaveSlot;
  out: Interval[][]; // Output Signal per Channel
  logic: Interval[][]; // combined Pulses before Flop and Mute
  pats: Interval[][][]; // Pulses per Channel per Pattern
  events: PatternEvent[][][]; // every Event, labelled, including those Chance blocked
}

function toIntervals(edges: Edge[]): Interval[] {
  const out: Interval[] = [];
  let start: number | null = null;
  for (const e of edges) {
    if (e.high && start === null) start = e.t;
    else if (!e.high && start !== null) {
      out.push({ start, end: e.t });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: HORIZON });
  return out;
}

function render(slot: SaveSlot): Rendered {
  const opts = { seed: 1 };
  return {
    slot,
    out: slot.channels.map((_, c) => toIntervals(new ChannelRenderer(c, opts).advance(slot, HORIZON))),
    logic: slot.channels.map((_, c) => toIntervals(combinedEdges(slot, c, 0, HORIZON, opts).edges)),
    pats: slot.channels.map((ch, c) => ch.patterns.map((_, p) => patternPulses(slot, c, p, 0, HORIZON, opts))),
    events: slot.channels.map((ch, c) => ch.patterns.map((_, p) => patternEvents(slot, c, p, 0, HORIZON, opts))),
  };
}

const within = (ivs: Interval[], a: number, b: number) => ivs.filter((iv) => iv.end > a && iv.start < b);
const isHigh = (ivs: Interval[], t: number) => ivs.some((iv) => iv.start <= t && iv.end > t);

/** Duration of one loop of a Pattern, in pulses. */
function loopPulses(slot: SaveSlot, c: number, p: number): number {
  const ch = slot.channels[c]!;
  const pat = ch.patterns[p]!;
  return Math.max(1, pat.length) * (ch.divide / (ch.ratchet || 1)) * ((pat.divide & 255) || 1);
}

// ---------- state ----------

let slotIndex = 0;
let channel = 0;
let data = render(slots[0]!.slot);
let playing = false;
let soundOn = true;
let stoppedAt = 0;
let audio: AudioContext | null = null;
let startedAt = 0;
let scheduledTo = 0;

function position(): number {
  if (!playing || !audio) return stoppedAt;
  return secondsToPulses(data.slot.clock, audio.currentTime - startedAt) % HORIZON;
}

// ---------- sound: one short blip per rising edge ----------

const VOICE: [OscillatorType, number, number][] = [
  ['sine', 55, 0.9], ['triangle', 190, 0.5], ['square', 7000, 0.08], ['square', 5000, 0.08],
  ['triangle', 420, 0.4], ['sine', 300, 0.4], ['sine', 520, 0.3], ['sine', 760, 0.3],
];

function blip(c: number, when: number) {
  if (!audio) return;
  const [type, freq, level] = VOICE[c]!;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(c === 0 ? freq * 3 : freq, when);
  if (c === 0) osc.frequency.exponentialRampToValueAtTime(freq, when + 0.08);
  gain.gain.setValueAtTime(level, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + (c === 0 ? 0.18 : 0.06));
  osc.connect(gain).connect(audio.destination);
  osc.start(when);
  osc.stop(when + 0.2);
}

function schedule() {
  if (!playing || !audio || !soundOn) return;
  const clock = data.slot.clock;
  const elapsed = audio.currentTime - startedAt;
  const loop = pulsesToSeconds(clock, HORIZON);
  const base = Math.floor(elapsed / loop) * loop;
  const from = Math.max(scheduledTo, secondsToPulses(clock, elapsed - base));
  const to = secondsToPulses(clock, elapsed - base + 0.12);
  if (to <= from || to > HORIZON) {
    scheduledTo = to > HORIZON ? 0 : scheduledTo;
    return;
  }
  data.out.forEach((ivs, c) => {
    for (const iv of ivs) {
      if (iv.start >= from && iv.start < to) blip(c, startedAt + base + pulsesToSeconds(clock, iv.start));
    }
  });
  scheduledTo = to;
}

// ---------- canvas plumbing ----------

const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
let W = 0;
let Hh = 0;
let hits: { x: number; y: number; w: number; h: number; c: number }[] = [];

function resize() {
  const top = canvas.getBoundingClientRect().top;
  W = window.innerWidth;
  Hh = window.innerHeight - top;
  const r = window.devicePixelRatio || 1;
  canvas.width = W * r;
  canvas.height = Hh * r;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${Hh}px`;
  g.setTransform(r, 0, 0, r, 0, 0);
}

function text(s: string, x: number, y: number, color = '#8b95a8', align: CanvasTextAlign = 'left') {
  g.fillStyle = color;
  g.textAlign = align;
  g.font = '12px ui-monospace, Menlo, monospace';
  g.fillText(s, x, y);
}

// Treatments of Length and Rotate inside the Scope lanes, switchable via ?lane=1..4 (↑ ↓).
const TREATMENTS = {
  '1': ['Brackets', 'bracket and shaded loop', 'line to triangle'],
  '2': ['Ghost', 'bracket', 'dashed outline of the unrotated Events, arrow to the first'],
  '3': ['Ruler', 'bracket and numbered steps', 'where step 1 sits'],
  '4': ['Wheel', 'dots on the dial, line at loop start', 'arc on the dial'],
  '5': ['Combined', 'dial, bracket, numbers', 'ghosts, cyan 1, dial arc'],
} as const;
type Treatment = keyof typeof TREATMENTS;
const treatment = (): Treatment => {
  const v = new URLSearchParams(location.search).get('lane') as Treatment | null;
  return v && v in TREATMENTS ? v : '5';
};

// Treatments of Pattern Divide in the ruler strip, switchable via ?div=1..4 ([ ]).
const DIVIDES = { '1': 'Plain', '2': 'Cells', '3': 'Ticks', '4': 'Cells, ticks and span' } as const;
type DivideTreatment = keyof typeof DIVIDES;
const divideTreatment = (): DivideTreatment => {
  const v = new URLSearchParams(location.search).get('div') as DivideTreatment | null;
  return v && v in DIVIDES ? v : '2';
};

// ---------- Variant A: Scope ----------
// Linear time. Every Channel's Output Signal on top; the selected Channel opened
// up underneath as eight Pattern lanes, the Logic result and the output.

function variantA(pos: number) {
  const span = 64;
  const page = Math.floor(pos / span) * span;
  const treat = treatment();
  const divTreat = divideTreatment();
  const ghost = treat === '2' || treat === '5';
  const ruler = treat === '3' || treat === '5';
  const wheel = treat === '4' || treat === '5';
  const left = wheel ? 260 : 200;
  const right = W - 20;
  const x = (t: number) => left + ((t - page) / span) * (right - left);

  const lane = (ivs: Interval[], y: number, h: number, color: string) => {
    g.fillStyle = color;
    for (const iv of within(ivs, page, page + span)) {
      const a = Math.max(x(iv.start), left);
      g.fillRect(a, y, Math.max(1.5, Math.min(x(iv.end), right) - a), h);
    }
  };
  const grid = (y: number, h: number) => {
    for (let p = 0; p <= span; p++) {
      g.fillStyle = p % 16 === 0 ? '#3a4458' : p % 4 === 0 ? '#232a38' : '#161b25';
      g.fillRect(x(page + p), y, 1, h);
    }
  };

  const rowH = Math.min(26, (Hh * 0.36) / 8);
  let y = 14;
  text(`all Channels, pulses ${page}-${page + span}`, left, y - 3);
  grid(y, rowH * 8);
  for (let c = 0; c < 8; c++) {
    if (c === channel) {
      g.fillStyle = '#ffffff10';
      g.fillRect(0, y, W, rowH);
    }
    text(ROMAN[c]!, left - 12, y + rowH * 0.7, hue(c), 'right');
    lane(data.out[c]!, y + 4, rowH - 8, hue(c));
    hits.push({ x: 0, y, w: W, h: rowH, c });
    y += rowH;
  }

  y += 30;
  const ch = data.slot.channels[channel]!;
  const detailH = Math.min(treat === '5' ? 50 : 38, (Hh - y - 110) / 10);
  text(`Channel ${ROMAN[channel]} opened up`, left, y - 6, hue(channel));
  grid(y, detailH * 10 + 16);
  const channelStep = ch.divide / (ch.ratchet || 1);
  const delay = (ch.rotate / 100) * channelStep;
  ch.patterns.forEach((pat, p) => {
    const len = Math.max(1, pat.length);
    const rot = ((pat.rotate % len) + len) % len;
    const step = channelStep * ((pat.divide & 255) || 1);
    const loop = len * step;
    const base = y + detailH * 0.7;
    if (pat.mute) text(`P${p + 1}`, left - 12, base, '#3a4458', 'right');
    else {
      // label: each number in its parameter's colour
      let lx = left - 12;
      const div = (pat.divide & 255) || 1;
      for (const [str, col] of [[`rot ${rot}`, ink.rotate(channel)], [div > 1 ? `div ${div}  ` : '', ink.divide(channel)], [`len ${len}  `, ink.length(channel)], [`P${p + 1}  `, '#cfd6e4']] as const) {
        text(str, lx, base, col, 'right');
        lx -= g.measureText(str).width;
      }

      const stepPx = ((right - left) / span) * step;
      const loops: number[] = [];
      for (let n = Math.floor((page - delay) / loop); delay + n * loop < page + span; n++) loops.push(n);
      const bracket = (s: number) => {
        if (s < page) return;
        g.fillStyle = ink.length(channel);
        g.fillRect(x(s), y + 1, 1.5, detailH - 2);
        g.fillRect(x(s), y + 1, 6, 1.5);
        g.fillRect(x(s), y + detailH - 2.5, 6, 1.5);
      };
      const ticks = () => {
        if (stepPx < 5) return;
        g.fillStyle = '#4a556b';
        for (let k = Math.ceil((page - delay) / step); delay + k * step < page + span; k++) {
          g.fillRect(x(delay + k * step), y + detailH - 4, 1, 3);
        }
      };

      if (treat === '1') {
        // Brackets: loops are shaded blocks; Rotate is a line from loop start to a triangle.
        for (const n of loops) {
          const s = delay + n * loop;
          const a = Math.max(x(s), left);
          const b = Math.min(x(s + loop), right);
          if (b <= a) continue;
          if (((n % 2) + 2) % 2 === 0) {
            g.fillStyle = '#ffffff0d';
            g.fillRect(a, y + 1, b - a, detailH - 2);
          }
          bracket(s);
          if (rot > 0) {
            const o = Math.min(x(s + rot * step), right);
            g.fillStyle = ink.rotate(channel);
            if (o > a) g.fillRect(a, y + 1, o - a, 1.5);
            if (s + rot * step >= page && s + rot * step < page + span) {
              g.beginPath();
              g.moveTo(o - 4, y + 1);
              g.lineTo(o + 4, y + 1);
              g.lineTo(o, y + 8);
              g.fill();
            }
          }
        }
        ticks();
      } else {
        const bottom = ruler ? 12 : 0; // strip under the Pulses kept for the ruler
        for (const n of loops) {
          const s = delay + n * loop;
          if (s < page) continue;
          g.fillStyle = ink.length(channel);
          g.fillRect(x(s), y + 1, 1.5, detailH - 2);
          if (!wheel || ghost || ruler) g.fillRect(x(s), y + 1, 6, 1.5);
        }

        if (ghost && rot > 0) {
          // The unrotated Events are outlined where they would have been;
          // an arrow carries the first one to where Rotate put it.
          const core = euclid(len, Math.min(pat.events, len));
          const gw = Math.max(3, (stepPx / ((pat.ratchet & 255) || 1)) * (ch.width / 100));
          for (const n of loops) {
            const s = delay + n * loop;
            let first = true;
            core.forEach((on, i) => {
              if (!on) return;
              const t = s + i * step;
              if (t < page || t >= page + span) return;
              g.strokeStyle = ink.rotate(channel, 0.6);
              g.lineWidth = 1;
              g.setLineDash([2, 2]);
              g.strokeRect(x(t) + 0.5, y + 7.5, gw - 1, detailH - 18 - bottom);
              g.setLineDash([]);
              if (first) {
                const o = Math.min(x(t + rot * step), right);
                g.fillStyle = ink.rotate(channel);
                g.fillRect(x(t) + 2, y + 3, o - x(t) - 2, 1.5);
                g.beginPath();
                g.moveTo(o, y);
                g.lineTo(o, y + 7);
                g.lineTo(o + 5, y + 3.5);
                g.fill();
                first = false;
              }
            });
          }
        }

        if (ruler && divTreat !== '1') {
          // Divide: how wide one step is, drawn in the strip under the Pulses.
          const sy = y + detailH - 12;
          const first = Math.floor((page - delay) / step);
          const cells = divTreat === '2' || divTreat === '4';
          const minor = divTreat === '3' || divTreat === '4';
          for (let k = first; delay + k * step < page + span; k++) {
            const t = delay + k * step;
            const a = Math.max(x(t), left);
            const b = Math.min(x(t + step), right);
            if (b <= a) continue;
            if (cells) {
              // every step is a cell; divided Patterns get wide orange ones
              g.fillStyle = div > 1 ? ink.divide(channel, k % 2 ? 0.25 : 0.5) : k % 2 ? '#ffffff05' : '#ffffff10';
              g.fillRect(a, sy, b - a, 11);
            }
            if (div > 1 && t >= page) {
              g.fillStyle = ink.divide(channel);
              g.fillRect(x(t), sy, 1.5, 11);
            }
            if (minor && div > 1 && (stepPx / div) >= 3) {
              // the Channel Clock pulses that one step swallows
              g.fillStyle = ink.divide(channel, 0.8);
              for (let m = 1; m < div; m++) {
                const mx = x(t + (m * step) / div);
                if (mx > left && mx < right) g.fillRect(mx, sy + 7, 1, 4);
              }
            }
          }
          if (divTreat === '4' && div > 1) {
            // one labelled span per loop: "a step is this long"
            g.font = '9px ui-monospace, Menlo, monospace';
            g.textAlign = 'center';
            for (const n of loops) {
              const t = delay + n * loop + rot * step;
              if (t < page || t + step > page + span) continue;
              const a = x(t);
              const b = x(t + step);
              g.fillStyle = ink.divide(channel);
              g.fillRect(a, y + detailH - 14, b - a, 1.5);
              g.fillRect(a, y + detailH - 17, 1.5, 5);
              g.fillRect(b - 1.5, y + detailH - 17, 1.5, 5);
              if (b - a > 26) g.fillText(`div ${div}`, (a + b) / 2, y + detailH - 17);
            }
          }
        }

        if (ruler) {
          // Steps are numbered under the lane, following the core euclidean
          // loop, so "1" sits wherever Rotate moved the start to.
          const every = stepPx >= 13 ? 1 : stepPx >= 6.5 ? 2 : stepPx >= 3.3 ? 4 : 8;
          g.font = '9px ui-monospace, Menlo, monospace';
          g.textAlign = 'left';
          for (const n of loops) {
            const s = delay + n * loop;
            for (let k = 0; k < len; k++) {
              const t = s + k * step;
              if (t < page || t >= page + span) continue;
              const num = ((((k - rot) % len) + len) % len) + 1;
              if (num !== 1 && (num - 1) % every !== 0) continue;
              g.fillStyle = num === 1 ? ink.rotate(channel) : '#6b7790';
              g.fillText(String(num), x(t) + 3, y + detailH - 2);
            }
          }
        } else ticks();

        if (wheel) {
          // A dial beside the lane holds one loop: dots are steps, the cyan arc
          // is Rotate, the hand is the playhead.
          const cx = 28;
          const cy = y + detailH / 2;
          const r = Math.max(4, detailH / 2 - 6);
          arc(cx, cy, r, 0, 1, 1, '#3a4458');
          if (rot > 0) arc(cx, cy, r + 3.5, 0, rot / len, 2, ink.rotate(channel));
          const kinds = patternStepKinds(pat);
          if (len <= 64) {
            kinds.forEach((kind, i) => {
              const an = -Math.PI / 2 + (i / len) * 2 * Math.PI;
              g.fillStyle = kind === 'event' ? ink.event(channel) : kind === 'burst' ? ink.burst(channel) : '#4a556b';
              g.beginPath();
              g.arc(cx + Math.cos(an) * r, cy + Math.sin(an) * r, kind ? 2.4 : 1, 0, 7);
              g.fill();
            });
          }
          const phase = ((((pos - delay) % loop) + loop) % loop) / loop;
          const an = -Math.PI / 2 + phase * 2 * Math.PI;
          g.strokeStyle = '#fff';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r);
          g.stroke();
        }
      }
    }
    if (pat.mute) {
      lane(data.pats[channel]![p]!, y + 7, detailH - 14, '#2a3140');
    } else {
      // Core Events are full height; Ratchet repeats are short; Burst repeats are
      // paler and tied to their Event by a green tail; Events Chance blocked are hollow.
      const strip = ruler ? 12 : 0;
      const top = y + 7;
      const full = detailH - 17 - strip;
      for (const e of data.events[channel]![p]!) {
        if (e.end <= page || e.start >= page + span) continue;
        const a = Math.max(x(e.start), left);
        const w = Math.max(1.5, Math.min(x(e.end), right) - a);
        const h = e.ratchet === 0 ? full : full * 0.5;
        const ey = top + full - h;
        if (!e.burst && e.ratchet === 0 && pat.burst > 1 && e.start >= page) {
          g.fillStyle = ink.burst(channel);
          g.fillRect(a, y + detailH - 9 - strip, Math.min(x(e.start + Math.min(pat.burst, len) * step), right) - a, 2);
        }
        if (e.passed) {
          g.fillStyle = e.burst ? ink.burst(channel) : ink.event(channel);
          g.fillRect(a, ey, w, h);
        } else {
          g.strokeStyle = ink.event(channel, 0.6);
          g.lineWidth = 1;
          g.strokeRect(a + 0.5, ey + 0.5, Math.max(1, w - 1), h - 1);
        }
      }
    }
    y += detailH;
  });
  y += 8;
  text(ch.logic, left - 12, y + detailH * 0.7, ink.logic(channel), 'right');
  lane(data.logic[channel]!, y + 3, detailH - 6, ink.logic(channel));
  y += detailH + 8;
  text(ch.flop ? 'flop' : 'out', left - 12, y + detailH * 0.7, hue(channel), 'right');
  lane(data.out[channel]!, y + 3, detailH - 6, hue(channel));

  y += detailH + 22;
  let lx = left;
  for (const [label, color] of [[`Length: ${TREATMENTS[treat][1]}`, ink.length(channel)], [`Rotate: ${TREATMENTS[treat][2]}`, ink.rotate(channel)], ['Divide: step cells', ink.divide(channel)], ['Burst: darker, with a tail', ink.burst(channel)], ['Ratchet: short bars', ink.event(channel)], ['Chance: hollow when blocked', ink.event(channel, 0.6)]] as const) {
    text(label, lx, y, color);
    lx += g.measureText(label).width + 28;
  }

  g.fillStyle = '#fff';
  g.fillRect(x(pos), 0, 1.5, Hh);
}

function arc(cx: number, cy: number, r: number, a: number, b: number, width: number, color: string) {
  const top = -Math.PI / 2;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.arc(cx, cy, r, top + a * 2 * Math.PI, top + Math.max(b, a + 0.004) * 2 * Math.PI);
  g.stroke();
}

// ---------- Variant C: Constellation ----------
// One sky for the whole Save Slot. Two bars per revolution, one orbit per Channel,
// a star on every rising edge, lines joining Channels that fire together.
// The selected Channel's orbit widens to show its Patterns and Logic.

function variantC(pos: number) {
  const span = 32;
  const page = Math.floor(pos / span) * span;
  const cx = W / 2;
  const cy = Hh / 2 - 10;
  const R = Math.min(W, Hh) * 0.46;
  const inner = R * 0.12;
  const ang = (t: number) => -Math.PI / 2 + ((t - page) / span) * 2 * Math.PI;
  const frac = (t: number) => Math.min(1, Math.max(0, (t - page) / span));

  // radial layout: selected Channel takes a wide band
  const wide = 6;
  const unit = (R - inner) / (7 + wide);
  const bands: { r0: number; r1: number }[] = [];
  let r = inner;
  for (let c = 0; c < 8; c++) {
    const w = (c === channel ? wide : 1) * unit;
    bands.push({ r0: r, r1: r + w });
    r += w;
  }

  for (let p = 0; p < span; p += 4) {
    const a = ang(page + p);
    g.strokeStyle = p % 16 === 0 ? '#2c3445' : '#161b25';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    g.stroke();
  }

  const stars: { t: number; r: number; c: number }[] = [];
  for (let c = 0; c < 8; c++) {
    const { r0, r1 } = bands[c]!;
    const ch = data.slot.channels[c]!;
    let orbit = (r0 + r1) / 2;
    if (c === channel) {
      const lanes = 10;
      const lh = (r1 - r0) / lanes;
      const channelStep = ch.divide / (ch.ratchet || 1);
      const delay = (ch.rotate / 100) * channelStep;
      const radial = (t: number, ra: number, rb: number, color: string, width = 1.5) => {
        if (t < page || t >= page + span) return;
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang(t)) * ra, cy + Math.sin(ang(t)) * ra);
        g.lineTo(cx + Math.cos(ang(t)) * rb, cy + Math.sin(ang(t)) * rb);
        g.stroke();
      };
      ch.patterns.forEach((pat, p) => {
        const lr = r0 + lh * (p + 0.5);
        arc(cx, cy, lr, 0, 1, 1, '#161b25');
        if (pat.mute) {
          for (const iv of within(data.pats[c]![p]!, page, page + span)) arc(cx, cy, lr, frac(iv.start), frac(iv.end), lh * 0.6, '#2a3140');
          return;
        }
        const len = Math.max(1, pat.length);
        const rot = ((pat.rotate % len) + len) % len;
        const div = (pat.divide & 255) || 1;
        const step = channelStep * div;
        const loop = len * step;
        const inner = lr - lh * 0.42;
        const outer = lr + lh * 0.42;

        // Divide: step cells along the inside edge of the lane
        if (div > 1) {
          for (let k = Math.floor((page - delay) / step); delay + k * step < page + span; k++) {
            const t = delay + k * step;
            if (k % 2 === 0) arc(cx, cy, inner, frac(t), frac(t + step), 2.5, ink.divide(c, 0.7));
            radial(t, inner - 2, inner + 3, ink.divide(c));
          }
        }
        for (let n = Math.floor((page - delay) / loop); delay + n * loop < page + span; n++) {
          const s = delay + n * loop;
          // Length: a tick across the lane at each loop start
          radial(s, inner - 2, outer + 2, ink.length(c), 2);
          // Rotate: dashed ghosts of the unrotated Events, and a bright mark where step 1 landed
          if (rot > 0) {
            g.setLineDash([2, 2]);
            euclid(len, Math.min(pat.events, len)).forEach((on, i) => {
              const t = s + i * step;
              if (on && t >= page && t < page + span) arc(cx, cy, lr, frac(t), frac(t + step * 0.5), 1, ink.rotate(c, 0.7));
            });
            g.setLineDash([]);
            const a = Math.max(s, page);
            const b = Math.min(s + rot * step, page + span);
            if (b > a) arc(cx, cy, outer + 1, frac(a), frac(b), 1, ink.rotate(c));
            radial(s + rot * step, lr, outer + 3, ink.rotate(c), 2);
          }
        }
        // Events: Ratchet repeats are thin, Burst repeats darker, Chance-blocked ones faint
        for (const e of data.events[c]![p]!) {
          if (e.end <= page || e.start >= page + span) continue;
          const w = lh * (e.ratchet === 0 ? 0.6 : 0.3);
          const color = e.passed ? (e.burst ? ink.burst(c) : ink.event(c)) : ink.event(c, 0.22);
          arc(cx, cy, lr, frac(e.start), frac(e.end), w, color);
        }
      });
      const lr = r0 + lh * 8.6;
      for (const iv of within(data.logic[c]!, page, page + span)) arc(cx, cy, lr, frac(iv.start), frac(iv.end), lh * 0.7, ink.logic(c));
      orbit = r0 + lh * 9.6;
    }
    arc(cx, cy, orbit, 0, 1, 1, '#232a38');
    for (const iv of within(data.out[c]!, page, page + span)) {
      arc(cx, cy, orbit, frac(iv.start), frac(iv.end), 3, dim(c, 0.55));
      if (iv.start >= page) stars.push({ t: iv.start, r: orbit, c });
    }
    text(ROMAN[c]!, cx + 5, cy - orbit + 4, hue(c));
  }

  // constellation lines between Channels that rise together
  stars.sort((a, b) => a.t - b.t || a.r - b.r);
  g.lineWidth = 1;
  for (let i = 1; i < stars.length; i++) {
    const a = stars[i - 1]!;
    const b = stars[i]!;
    if (Math.abs(a.t - b.t) > 1e-6) continue;
    const age = pos - a.t;
    g.strokeStyle = age >= 0 && age < 4 ? `rgb(255 255 255 / ${0.7 - age * 0.15})` : '#ffffff18';
    g.beginPath();
    g.moveTo(cx + Math.cos(ang(a.t)) * a.r, cy + Math.sin(ang(a.t)) * a.r);
    g.lineTo(cx + Math.cos(ang(b.t)) * b.r, cy + Math.sin(ang(b.t)) * b.r);
    g.stroke();
  }
  for (const s of stars) {
    const age = pos - s.t;
    const glow = age >= 0 && age < 2 ? 1 - age / 2 : 0;
    g.fillStyle = glow ? '#fff' : hue(s.c);
    g.beginPath();
    g.arc(cx + Math.cos(ang(s.t)) * s.r, cy + Math.sin(ang(s.t)) * s.r, 2.5 + glow * 5, 0, 7);
    g.fill();
  }

  g.strokeStyle = '#ffffff90';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx + Math.cos(ang(pos)) * inner, cy + Math.sin(ang(pos)) * inner);
  g.lineTo(cx + Math.cos(ang(pos)) * R, cy + Math.sin(ang(pos)) * R);
  g.stroke();

  // hit areas: radial bands
  canvas.onclick = (e) => {
    const b = canvas.getBoundingClientRect();
    const d = Math.hypot(e.clientX - b.left - cx, e.clientY - b.top - cy);
    const c = bands.findIndex((band) => d >= band.r0 && d < band.r1);
    if (c >= 0) select(c);
  };
}

// ---------- switcher and controls ----------

const VARIANTS = { A: ['Scope', variantA], C: ['Constellation', variantC] } as const;
type Key = keyof typeof VARIANTS;
const keys = Object.keys(VARIANTS) as Key[];
const current = (): Key => {
  const v = new URLSearchParams(location.search).get('variant') as Key | null;
  return v && v in VARIANTS ? v : 'A';
};

function cycle(by: number) {
  const next = keys[(keys.indexOf(current()) + by + keys.length) % keys.length]!;
  const url = new URL(location.href);
  url.searchParams.set('variant', next);
  history.replaceState(null, '', url);
  showState();
}

function cycleDivide(by: number) {
  const all = Object.keys(DIVIDES) as DivideTreatment[];
  const url = new URL(location.href);
  url.searchParams.set('div', all[(all.indexOf(divideTreatment()) + by + all.length) % all.length]!);
  history.replaceState(null, '', url);
  showState();
}

function cycleTreatment(by: number) {
  const all = Object.keys(TREATMENTS) as Treatment[];
  const url = new URL(location.href);
  url.searchParams.set('lane', all[(all.indexOf(treatment()) + by + all.length) % all.length]!);
  history.replaceState(null, '', url);
  showState();
}

function select(c: number) {
  channel = c;
  showState();
}

function showState() {
  const v = current();
  document.getElementById('label')!.textContent =
    `${v} (${VARIANTS[v][0]})` + (v === 'A' ? `  ·  lane ${treatment()} ${TREATMENTS[treatment()][0]}  ↑↓  ·  div ${divideTreatment()} ${DIVIDES[divideTreatment()]}  [ ]` : '');
  const ch = data.slot.channels[channel]!;
  const k = data.slot.clock;
  const pats = ch.patterns
    .map((p, i) => (p.mute ? '' : `P${i + 1} len ${p.length} ev ${p.events} rot ${p.rotate} burst ${p.burst} ratchet ${p.ratchet} div ${p.divide} chance ${p.chance}`))
    .filter(Boolean);
  document.getElementById('state')!.textContent =
    `slot ${slots[slotIndex]!.name}  ${k.bpm} bpm  swing ${k.swing}   Channel ${ROMAN[channel]}: ${ch.logic}` +
    `${ch.flop ? ' flop' : ''}${ch.mute ? ' MUTED' : ''} width ${ch.width} clock x${ch.ratchet}/${ch.divide} rotate ${ch.rotate}\n` +
    pats.slice(0, 4).join('\n') +
    (pats.length > 4 ? `\n(+${pats.length - 4} more Patterns)` : '');
  document.querySelectorAll('#slots button').forEach((b, i) => b.classList.toggle('on', i === slotIndex));
}

function loadSlot(i: number) {
  // keep position across the switch, like the module's in-sync load
  const pos = position();
  slotIndex = i;
  data = render(slots[i]!.slot);
  if (playing && audio) {
    startedAt = audio.currentTime - pulsesToSeconds(data.slot.clock, pos);
    scheduledTo = pos;
  }
  showState();
}

const slotsEl = document.getElementById('slots')!;
slots.forEach((s, i) => {
  const b = document.createElement('button');
  b.textContent = s.name;
  b.onclick = () => loadSlot(i);
  slotsEl.append(b);
});

const playBtn = document.getElementById('play')!;
playBtn.onclick = () => {
  if (!playing) {
    audio ??= new AudioContext();
    void audio.resume();
    startedAt = audio.currentTime - pulsesToSeconds(data.slot.clock, stoppedAt);
    scheduledTo = stoppedAt;
  } else {
    stoppedAt = 0; // stop is also Reset
  }
  playing = !playing;
  playBtn.textContent = playing ? 'stop' : 'play';
  playBtn.classList.toggle('on', playing);
};
const soundBtn = document.getElementById('sound')!;
soundBtn.onclick = () => {
  soundOn = !soundOn;
  soundBtn.classList.toggle('on', soundOn);
};

document.getElementById('prev')!.onclick = () => cycle(-1);
document.getElementById('next')!.onclick = () => cycle(1);
if (import.meta.env.PROD) document.getElementById('switcher')!.remove();

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, textarea, [contenteditable]')) return;
  if (e.key === '[') cycleDivide(-1);
  else if (e.key === ']') cycleDivide(1);
  else if (e.key === 'ArrowUp') cycleTreatment(-1);
  else if (e.key === 'ArrowDown') cycleTreatment(1);
  else if (e.key === 'ArrowLeft') cycle(-1);
  else if (e.key === 'ArrowRight') cycle(1);
  else if (e.key === ' ') {
    e.preventDefault();
    playBtn.click();
  } else if (/^[1-8]$/.test(e.key)) select(parseInt(e.key, 10) - 1);
});

function frame() {
  schedule();
  const pos = position();
  g.clearRect(0, 0, W, Hh);
  hits = [];
  canvas.onclick = (e) => {
    const b = canvas.getBoundingClientRect();
    const hit = hits.find((h) => e.clientX - b.left >= h.x && e.clientX - b.left < h.x + h.w && e.clientY - b.top >= h.y && e.clientY - b.top < h.y + h.h);
    if (hit) select(hit.c);
  };
  VARIANTS[current()][1](pos);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
showState();
resize();
frame();
