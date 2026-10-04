import { ROMAN, ink } from './scope';
import type { Timeline } from './timeline';

// The Constellation: one sky for the whole Save Slot. Two bars to a revolution,
// one orbit per Channel with Channel I innermost, a star on every rising edge,
// and a line joining Channels that rise together.

/** Pulses per revolution. */
export const SKY_SPAN = 32;
const CHANNELS = 8;

export interface SkyView {
  timeline: Timeline;
  channel: number;
  pos: number;
}

/** Orbit radii for a square sky of the given size. */
function orbits(size: number) {
  // Leave room outside the last orbit for half an arc and a flaring star.
  const outer = size / 2 - Math.max(8, size * 0.05);
  const inner = outer * 0.2;
  const gap = (outer - inner) / (CHANNELS - 1);
  return { centre: size / 2, inner, outer, gap, radius: (c: number) => inner + c * gap };
}

/** The Channel whose orbit is nearest a point, or -1 outside the sky. */
export function skyChannelAt(size: number, x: number, y: number): number {
  const { centre, inner, outer, gap } = orbits(size);
  const d = Math.hypot(x - centre, y - centre);
  if (d < inner - gap / 2 || d > outer + gap / 2) return -1;
  return Math.min(CHANNELS - 1, Math.max(0, Math.round((d - inner) / gap)));
}

export function drawSky(g: CanvasRenderingContext2D, size: number, view: SkyView): void {
  const { timeline, channel, pos } = view;
  const { centre, inner, outer, gap, radius } = orbits(size);
  // Arcs take half the room between orbits, so they grow with the sky.
  const thick = Math.max(3, gap * 0.5);
  const page = Math.floor(pos / SKY_SPAN) * SKY_SPAN;
  const angle = (t: number) => -Math.PI / 2 + ((t - page) / SKY_SPAN) * 2 * Math.PI;
  const at = (t: number, r: number): [number, number] => [centre + Math.cos(angle(t)) * r, centre + Math.sin(angle(t)) * r];
  const spoke = (t: number, color: string, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(...at(t, inner - 4));
    g.lineTo(...at(t, outer + 4));
    g.stroke();
  };

  g.clearRect(0, 0, size, size);
  // A spoke per beat, brighter on the bar.
  for (let p = 0; p < SKY_SPAN; p += 4) spoke(page + p, p % 16 === 0 ? '#2c3445' : '#161b25', 1);

  const stars: { t: number; r: number; c: number }[] = [];
  for (let c = 0; c < CHANNELS; c++) {
    const r = radius(c);
    g.strokeStyle = c === channel ? ink.event(c, 0.45) : '#232a38';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(centre, centre, r, 0, 2 * Math.PI);
    g.stroke();
    for (const iv of timeline.intervals(c, page, page + SKY_SPAN)) {
      const a = Math.max(iv.start, page);
      const b = Math.min(iv.end, page + SKY_SPAN);
      g.strokeStyle = ink.event(c, 0.55);
      g.lineWidth = thick;
      g.beginPath();
      g.arc(centre, centre, r, angle(a), angle(b));
      g.stroke();
      if (iv.start >= page) stars.push({ t: iv.start, r, c });
    }
  }

  // Lines between Channels that rise together; they flare as the playhead passes.
  stars.sort((a, b) => a.t - b.t || a.r - b.r);
  g.lineWidth = 1;
  for (let i = 1; i < stars.length; i++) {
    const a = stars[i - 1]!;
    const b = stars[i]!;
    if (Math.abs(a.t - b.t) > 1e-6) continue;
    const age = pos - a.t;
    g.strokeStyle = age >= 0 && age < 4 ? `rgb(255 255 255 / ${0.7 - age * 0.15})` : '#ffffff18';
    g.beginPath();
    g.moveTo(...at(a.t, a.r));
    g.lineTo(...at(b.t, b.r));
    g.stroke();
  }
  for (const s of stars) {
    const age = pos - s.t;
    const glow = age >= 0 && age < 2 ? 1 - age / 2 : 0;
    g.fillStyle = glow ? '#fff' : ink.event(s.c);
    g.beginPath();
    g.arc(...at(s.t, s.r), Math.max(1.8, thick * 0.22) + glow * thick * 0.4, 0, 2 * Math.PI);
    g.fill();
  }

  spoke(pos, '#ffffff90', 1.5);

  g.font = '9px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.fillStyle = ink.event(channel);
  g.fillText(ROMAN[channel]!, centre, centre + 3);
}
