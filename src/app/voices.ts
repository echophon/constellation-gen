import * as Tone from 'tone';

// One gate-driven voice per Channel. Every voice has a sustain stage, so a
// longer gate (Width, Flop) is heard as a longer note and a short trigger as a hit.

export type VoiceType = 'kick' | 'noise' | 'tone';
export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface VoiceSettings {
  type: VoiceType;
  /** Oscillator shape; used by 'tone'. */
  wave: Wave;
  /** dB. */
  level: number;
  /** MIDI note for 'kick' and 'tone'; highpass cutoff in Hz for 'noise'. */
  tune: number;
  decay: number;
  /** Level held while the gate stays open, 0..1. */
  sustain: number;
  release: number;
}

const v = (type: VoiceType, wave: Wave, level: number, tune: number, decay: number, sustain: number, release: number): VoiceSettings => ({
  type, wave, level, tune, decay, sustain, release,
});

/** Follows the manual's Quick Start: kick, snare, closed hat, open hat, rim, then three pitched voices. */
export const DEFAULT_VOICES: VoiceSettings[] = [
  v('kick', 'sine', -4, 24, 0.25, 0.35, 0.04),
  v('noise', 'sine', -10, 900, 0.12, 0.25, 0.04),
  v('noise', 'sine', -16, 7000, 0.03, 0.2, 0.01),
  v('noise', 'sine', -16, 5000, 0.2, 0.35, 0.12),
  v('tone', 'triangle', -12, 67, 0.03, 0.4, 0.02),
  v('tone', 'sine', -10, 48, 0.08, 0.6, 0.03),
  v('tone', 'triangle', -12, 55, 0.08, 0.6, 0.03),
  v('tone', 'square', -20, 60, 0.08, 0.5, 0.03),
];

const STORE = 'constellation.voices';

function load(): VoiceSettings[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as VoiceSettings[] | null;
    if (Array.isArray(saved) && saved.length === 8) return saved.map((s, i) => ({ ...DEFAULT_VOICES[i]!, ...s }));
  } catch {
    // unreadable or unavailable storage: fall through to the defaults
  }
  return DEFAULT_VOICES.map((s) => ({ ...s }));
}

/** The voice settings in use. Change them through `setVoice`. */
export const voiceSettings: VoiceSettings[] = load();

interface Voice {
  attack(when: number): void;
  release(when: number): void;
  dispose(): void;
}

function build(s: VoiceSettings, out: Tone.ToneAudioNode): Voice {
  const envelope = { attack: 0.001, decay: s.decay, sustain: s.sustain, release: s.release };
  if (s.type === 'noise') {
    const synth = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope, volume: s.level });
    const filter = new Tone.Filter(s.tune, 'highpass');
    synth.chain(filter, out);
    return {
      attack: (t) => synth.triggerAttack(t),
      release: (t) => synth.triggerRelease(t),
      dispose: () => {
        synth.dispose();
        filter.dispose();
      },
    };
  }
  const note = Tone.Frequency(s.tune, 'midi').toFrequency();
  const synth =
    s.type === 'kick'
      ? new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 5, envelope, volume: s.level })
      : new Tone.Synth({ oscillator: { type: s.wave }, envelope, volume: s.level });
  synth.connect(out);
  return {
    attack: (t) => synth.triggerAttack(note, t),
    release: (t) => synth.triggerRelease(t),
    dispose: () => synth.dispose(),
  };
}

let instance: Voices | null = null;

export class Voices {
  private readonly out: Tone.ToneAudioNode;
  private readonly voices: Voice[];

  constructor() {
    // Events are scheduled at explicit audio-clock times, so Tone's own look-ahead is not wanted.
    Tone.getContext().lookAhead = 0;
    this.out = new Tone.Limiter(-3).toDestination();
    this.voices = voiceSettings.map((s) => build(s, this.out));
    instance = this;
  }

  /** The audio clock, in seconds. */
  get now(): number {
    return Tone.getContext().currentTime;
  }

  resume(): Promise<void> {
    return Tone.start();
  }

  /** Opens or closes one Channel's gate at an audio-clock time. */
  gate(channel: number, high: boolean, when: number): void {
    const voice = this.voices[channel]!;
    const t = Math.max(when, this.now);
    if (high) voice.attack(t);
    else voice.release(t);
  }

  rebuild(channel: number): void {
    const old = this.voices[channel]!;
    old.release(this.now);
    this.voices[channel] = build(voiceSettings[channel]!, this.out);
    setTimeout(() => old.dispose(), 500);
  }
}

/** Changes one Channel's voice, applies it if audio is running, and remembers it. */
export function setVoice(channel: number, change: Partial<VoiceSettings>): void {
  Object.assign(voiceSettings[channel]!, change);
  instance?.rebuild(channel);
  try {
    localStorage.setItem(STORE, JSON.stringify(voiceSettings));
  } catch {
    // storage unavailable: the change still applies for this session
  }
}

export const noteName = (midi: number): string => Tone.Frequency(midi, 'midi').toNote();
