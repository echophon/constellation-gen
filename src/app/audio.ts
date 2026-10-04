// Placeholder voices: one short blip per rising edge, until the audition design is settled.

const VOICE: [OscillatorType, number, number][] = [
  ['sine', 55, 0.9], ['triangle', 190, 0.5], ['square', 7000, 0.08], ['square', 5000, 0.08],
  ['triangle', 420, 0.4], ['sine', 300, 0.4], ['sine', 520, 0.3], ['sine', 760, 0.3],
];

export class Blips {
  readonly ctx = new AudioContext();

  get now(): number {
    return this.ctx.currentTime;
  }

  play(channel: number, when: number): void {
    const [type, freq, level] = VOICE[channel]!;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(channel === 0 ? freq * 3 : freq, when);
    if (channel === 0) osc.frequency.exponentialRampToValueAtTime(freq, when + 0.08);
    gain.gain.setValueAtTime(level, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + (channel === 0 ? 0.18 : 0.06));
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + 0.2);
  }
}
