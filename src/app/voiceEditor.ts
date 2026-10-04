import { ROMAN, ink } from './scope';
import { DEFAULT_VOICES, noteName, setVoice, voiceSettings, type VoiceSettings, type VoiceType, type Wave } from './voices';

// A plain table: one row per Channel, one control per voice setting.

function select<T extends string>(options: T[], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const el = document.createElement('select');
  for (const o of options) el.append(new Option(o, o, false, o === value));
  el.onchange = () => onChange(el.value as T);
  return el;
}

function slider(min: number, max: number, step: number, value: number, show: (v: number) => string, onChange: (v: number) => void): HTMLElement {
  const input = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const readout = document.createElement('span');
  readout.textContent = show(value);
  input.oninput = () => {
    readout.textContent = show(input.valueAsNumber);
    onChange(input.valueAsNumber);
  };
  const wrap = document.createElement('label');
  wrap.append(input, readout);
  return wrap;
}

const seconds = (s: number) => `${Math.round(s * 1000)} ms`;

export function buildVoiceEditor(root: HTMLElement): void {
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const h of ['', 'voice', 'shape', 'level', 'tune', 'decay', 'sustain', 'release']) head.append(Object.assign(document.createElement('th'), { textContent: h }));

  voiceSettings.forEach((s: VoiceSettings, c) => {
    const row = table.insertRow();
    const name = row.insertCell();
    name.textContent = ROMAN[c]!;
    name.style.color = ink.event(c);

    const tuneCell = document.createElement('td');
    const shapeCell = document.createElement('td');
    const drawTune = () => {
      // Tune means a note for pitched voices and a filter cutoff for noise.
      const pitched = s.type !== 'noise';
      if (pitched && (s.tune < 12 || s.tune > 96)) setVoice(c, { tune: s.type === 'kick' ? 24 : 60 });
      if (!pitched && s.tune < 100) setVoice(c, { tune: 4000 });
      tuneCell.replaceChildren(
        pitched
          ? slider(12, 96, 1, s.tune, noteName, (tune) => setVoice(c, { tune }))
          : slider(100, 12000, 100, s.tune, (hz) => `${hz} Hz`, (tune) => setVoice(c, { tune })),
      );
      shapeCell.replaceChildren(
        s.type === 'tone' ? select<Wave>(['sine', 'triangle', 'square', 'sawtooth'], s.wave, (wave) => setVoice(c, { wave })) : '',
      );
    };

    row.insertCell().append(
      select<VoiceType>(['kick', 'noise', 'tone'], s.type, (type) => {
        setVoice(c, { type });
        drawTune();
      }),
    );
    row.append(shapeCell);
    row.insertCell().append(slider(-40, 0, 1, s.level, (dB) => `${dB} dB`, (level) => setVoice(c, { level })));
    row.append(tuneCell);
    row.insertCell().append(slider(0.01, 1, 0.01, s.decay, seconds, (decay) => setVoice(c, { decay })));
    row.insertCell().append(slider(0, 1, 0.05, s.sustain, (x) => `${Math.round(x * 100)}%`, (sustain) => setVoice(c, { sustain })));
    row.insertCell().append(slider(0.005, 1, 0.005, s.release, seconds, (release) => setVoice(c, { release })));
    drawTune();
  });

  const reset = Object.assign(document.createElement('button'), { textContent: 'reset voices' });
  reset.onclick = () => {
    DEFAULT_VOICES.forEach((d, c) => setVoice(c, { ...d }));
    buildVoiceEditor(root);
  };
  root.replaceChildren(table, reset);
}
