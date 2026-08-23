/**
 * Web MIDI input → numeric signals (note, velocity, gate, CC, clock).
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const MIDI_CORE_SIGNALS = [
  { key: 'note', label: 'Note' },
  { key: 'vel', label: 'Velocity' },
  { key: 'gate', label: 'Gate' },
  { key: 'pitch', label: 'Pitch bend' },
  { key: 'ch', label: 'Channel' },
  { key: 'bpm', label: 'BPM' },
  { key: 'beat', label: 'Beat' },
];

export function noteName(n) {
  const note = Math.round(Number(n));
  if (!Number.isFinite(note) || note < 0 || note > 127) return '—';
  const name = NOTE_NAMES[note % 12];
  const oct = Math.floor(note / 12) - 1;
  return `${name}${oct}`;
}

export function midiSignalRows(inst) {
  const learned = Array.isArray(inst?.settings?.learned) ? inst.settings.learned : [];
  const extra = learned
    .filter((l) => l?.key && !MIDI_CORE_SIGNALS.some((c) => c.key === l.key))
    .map((l) => ({
      key: String(l.key),
      label: l.type === 'note' ? `Note ${noteName(l.num)}` : l.type === 'cc' ? `CC ${l.num}` : String(l.key),
    }));
  return [...MIDI_CORE_SIGNALS, ...extra];
}

export function parseLearn(status, data1, data2) {
  if (status >= 0xf0) return null;
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  if (type === 0xb0) return { type: 'cc', ch, num: data1 & 0x7f, key: `cc/${data1 & 0x7f}` };
  if (type === 0x90 && data2 > 0) return { type: 'note', ch, num: data1 & 0x7f, key: `note/${data1 & 0x7f}` };
  if (type === 0x80) return { type: 'note', ch, num: data1 & 0x7f, key: `note/${data1 & 0x7f}` };
  return null;
}

let sharedAccess = null;
let accessWait = null;

export async function requestMidiAccess() {
  if (sharedAccess) return sharedAccess;
  if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is not available in this browser');
  if (!accessWait) {
    accessWait = navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      sharedAccess = access;
      return access;
    });
  }
  return accessWait;
}

export function listMidiInputs(access = sharedAccess) {
  if (!access) return [];
  return [...access.inputs.values()].map((input, i) => ({
    id: input.id,
    name: input.name || `MIDI ${i + 1}`,
    manufacturer: input.manufacturer || '',
  }));
}

export class MidiSource {
  constructor({ onValues, onStatus, onLearn } = {}) {
    this.onValues = onValues || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onLearn = onLearn || (() => {});
    this.connected = false;
    this.inputId = '';
    this.inputName = '';
    this.channel = 0;
    this.learning = false;
    this.values = {
      note: 0,
      vel: 0,
      gate: 0,
      pitch: 0,
      ch: 1,
      bpm: 0,
      beat: 0,
    };
    this._input = null;
    this._held = new Set();
    this._clockTimes = [];
    this._clockCount = 0;
    this._unsubState = null;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  setChannel(ch) {
    const n = Number(ch);
    this.channel = Number.isFinite(n) ? Math.max(0, Math.min(16, Math.round(n))) : 0;
  }

  setLearn(on) {
    this.learning = !!on;
  }

  async listInputs() {
    const access = await requestMidiAccess();
    return listMidiInputs(access);
  }

  async connect(inputId = '') {
    if (!MidiSource.isSupported()) throw new Error('Web MIDI is not available in this browser');
    this.disconnect();
    this.onStatus({ connecting: true, connected: false });

    const access = await requestMidiAccess();
    const inputs = [...access.inputs.values()];
    const input = (inputId && inputs.find((i) => i.id === inputId)) || inputs[0] || null;
    if (!input) {
      this.onStatus({ connecting: false, connected: false, error: 'No MIDI input found' });
      throw new Error('No MIDI input found');
    }

    this._input = input;
    this.inputId = input.id;
    this.inputName = input.name || 'MIDI';
    this.connected = true;
    input.onmidimessage = (e) => this._onMidi(e);

    const onState = () => {
      if (this._input && this._input.state === 'disconnected') this.disconnect();
    };
    access.addEventListener('statechange', onState);
    this._unsubState = () => access.removeEventListener('statechange', onState);

    this.onStatus({ connecting: false, connected: true, name: this.inputName, inputId: this.inputId });
    this.onValues({ ...this.values }, { ...this.values });
    return { inputId: this.inputId, name: this.inputName };
  }

  disconnect() {
    if (this._input) {
      this._input.onmidimessage = null;
      this._input = null;
    }
    this._unsubState?.();
    this._unsubState = null;
    this._held.clear();
    this._clockTimes = [];
    this._clockCount = 0;
    this.connected = false;
    this.learning = false;
    this.values.gate = 0;
    this.values.vel = 0;
    this.values.beat = 0;
    this.onStatus({ connecting: false, connected: false, name: this.inputName });
  }

  _onMidi(event) {
    const data = event.data;
    if (!data || !data.length) return;
    const status = data[0];
    const d1 = data[1] || 0;
    const d2 = data[2] || 0;
    const changed = {};

    if (status === 0xf8) {
      this._onClock(event.timeStamp || performance.now(), changed);
    } else if (status === 0xfa || status === 0xfb) {
      this._clockCount = 0;
      this._clockTimes = [];
    } else if (status === 0xfc) {
      this.values.beat = 0;
      changed.beat = 0;
    } else if (status < 0xf0) {
      const type = status & 0xf0;
      const ch = (status & 0x0f) + 1;
      if (this.channel && ch !== this.channel) return;
      this.values.ch = ch;
      changed.ch = ch;

      if (this.learning) {
        const learned = parseLearn(status, d1, d2);
        if (learned && (learned.type === 'cc' || (learned.type === 'note' && type === 0x90 && d2 > 0))) {
          this.learning = false;
          this.onLearn(learned);
        }
      }

      if (type === 0x90 || type === 0x80) {
        const note = d1 & 0x7f;
        const vel = type === 0x90 ? d2 & 0x7f : 0;
        const on = type === 0x90 && vel > 0;
        if (on) this._held.add(note);
        else this._held.delete(note);
        this.values.note = note;
        this.values.vel = (on ? vel : 0) / 127;
        this.values.gate = this._held.size ? 1 : 0;
        changed.note = this.values.note;
        changed.vel = this.values.vel;
        changed.gate = this.values.gate;
        const key = `note/${note}`;
        this.values[key] = this.values.vel;
        changed[key] = this.values.vel;
      } else if (type === 0xb0) {
        const num = d1 & 0x7f;
        const value = (d2 & 0x7f) / 127;
        const key = `cc/${num}`;
        this.values[key] = value;
        changed[key] = value;
      } else if (type === 0xe0) {
        const raw = ((d2 & 0x7f) << 7) | (d1 & 0x7f);
        const pitch = (raw - 8192) / 8192;
        this.values.pitch = Math.round(pitch * 1e6) / 1e6;
        changed.pitch = this.values.pitch;
      }
    }

    if (Object.keys(changed).length) this.onValues({ ...this.values }, changed);
  }

  _onClock(now, changed) {
    this._clockTimes.push(now);
    if (this._clockTimes.length > 48) this._clockTimes.shift();
    if (this._clockTimes.length >= 8) {
      const span = this._clockTimes[this._clockTimes.length - 1] - this._clockTimes[0];
      const dt = span / (this._clockTimes.length - 1);
      if (dt > 0) {
        const bpm = 60_000 / (dt * 24);
        if (Number.isFinite(bpm) && bpm > 20 && bpm < 400) {
          this.values.bpm = Math.round(bpm * 10) / 10;
          changed.bpm = this.values.bpm;
        }
      }
    }
    this._clockCount = (this._clockCount + 1) % 24;
    if (this._clockCount === 0) {
      this.values.beat = 1;
      changed.beat = 1;
    }
  }
}
