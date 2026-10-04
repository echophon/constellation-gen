import { ChannelRenderer, type Interval, type SaveSlot } from '../engine/index';

/** Playback loops here, in Main Clock pulses. */
export const HORIZON = 1024;
const CHUNK = 32;
export const SEED = 1;

/**
 * Output Signals of one Save Slot, rendered from Reset only as far as asked.
 * Thrown away and rebuilt whenever the Save Slot is edited.
 */
export class Timeline {
  readonly out: Interval[][];
  private readonly open: (number | null)[];
  private readonly renderers: ChannelRenderer[];
  private renderedTo = 0;

  constructor(readonly slot: SaveSlot) {
    this.out = slot.channels.map(() => []);
    this.open = slot.channels.map(() => null);
    this.renderers = slot.channels.map((_, c) => new ChannelRenderer(c, { seed: SEED }));
  }

  ensure(to: number): void {
    const target = Math.min(to, HORIZON);
    while (this.renderedTo < target) {
      const next = Math.min(target, this.renderedTo + CHUNK);
      this.renderers.forEach((r, c) => {
        for (const e of r.advance(this.slot, next)) {
          const start = this.open[c];
          if (e.high && start == null) this.open[c] = e.t;
          else if (!e.high && start != null) {
            this.out[c]!.push({ start, end: e.t });
            this.open[c] = null;
          }
        }
      });
      this.renderedTo = next;
    }
  }

  /** Output Signal of one Channel overlapping [a, b). */
  intervals(c: number, a: number, b: number): Interval[] {
    this.ensure(b);
    const found = this.out[c]!.filter((iv) => iv.end > a && iv.start < b);
    const start = this.open[c];
    if (start != null && start < b) found.push({ start, end: this.renderedTo });
    return found;
  }

  /** Times in [a, b) at which a Channel's Output Signal rises. */
  rises(c: number, a: number, b: number): number[] {
    return this.intervals(c, a, b)
      .map((iv) => iv.start)
      .filter((t) => t >= a && t < b);
  }
}
