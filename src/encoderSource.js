/**
 * Rotary encoder + switch (Raspberry Pi GPIO via the local gateway).
 */

export const ENCODER_MAX_SIGNALS = 16;
export const ENCODER_MAX_PIN = 27;
const NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function defaultEncoderSignals(count) {
  const n = clampCount(count);
  return Array.from({ length: n }, (_, i) => ({
    name: i < NAMES.length ? NAMES[i] : `sig${i + 1}`,
    steps: 100,
    value: 0,
  }));
}

export const DEFAULT_ENCODER_SETTINGS = {
  clk: 17,
  dt: 18,
  sw: 27,
  invert: false,
  mode: 'raw',
  signalCount: 4,
  selected: 0,
  signals: defaultEncoderSignals(4),
  autoConnect: false,
};

export function clampCount(n) {
  const v = Math.round(Number(n) || 0);
  return Math.max(1, Math.min(ENCODER_MAX_SIGNALS, v));
}

export function clampPin(n, fallback) {
  const v = Math.round(Number(n));
  if (!Number.isInteger(v) || v < 0 || v > ENCODER_MAX_PIN) return fallback;
  return v;
}

export function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function encoderMode(v) {
  return String(v || '').toLowerCase() === 'modeselector' ? 'modeselector' : 'raw';
}

function sanitizeName(v, i) {
  const s = String(v ?? '').trim();
  if (s) return s.slice(0, 32);
  return i < NAMES.length ? NAMES[i] : `sig${i + 1}`;
}

function sanitizeSteps(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(1, Math.min(10000, n || 100));
}

export function normalizeEncoderSignals(list, count) {
  const n = clampCount(count ?? list?.length ?? 4);
  const prev = Array.isArray(list) ? list : [];
  return Array.from({ length: n }, (_, i) => {
    const row = prev[i] || {};
    const steps = sanitizeSteps(row.steps);
    const raw = Number(row.value);
    const tick = Number.isFinite(raw) ? Math.round(clamp01(raw) * steps) : 0;
    return {
      name: sanitizeName(row.name, i),
      steps,
      value: tick / steps,
    };
  });
}

export function normalizeEncoderSettings(raw = {}) {
  const signalCount = clampCount(raw.signalCount ?? raw.signals?.length ?? 4);
  const signals = normalizeEncoderSignals(raw.signals, signalCount);
  const selected = Math.max(0, Math.min(signals.length - 1, Math.round(Number(raw.selected) || 0)));
  return {
    clk: clampPin(raw.clk, 17),
    dt: clampPin(raw.dt, 18),
    sw: clampPin(raw.sw, 27),
    invert: !!raw.invert,
    mode: encoderMode(raw.mode),
    signalCount,
    selected,
    signals,
    autoConnect: !!raw.autoConnect,
  };
}

export function encoderPinsOk(settings) {
  const s = normalizeEncoderSettings(settings);
  const pins = [s.clk, s.dt, s.sw];
  return new Set(pins).size === 3;
}

export function encoderSignalRows(inst) {
  const s = normalizeEncoderSettings(inst?.settings || {});
  if (s.mode === 'modeselector') {
    const rows = [
      { key: 'index', label: 'Selected' },
      { key: 'name', label: 'Name' },
      { key: 'value', label: 'Current' },
      { key: 'sw', label: 'Switch' },
    ];
    s.signals.forEach((sig, i) => {
      rows.push({ key: `sig/${i + 1}`, label: sig.name || `Signal ${i + 1}` });
    });
    return rows;
  }
  return [
    { key: 'cw', label: 'Clockwise' },
    { key: 'ccw', label: 'Counter-clockwise' },
    { key: 'sw', label: 'Switch' },
  ];
}

export function encoderLiveValues(settings) {
  const s = normalizeEncoderSettings(settings);
  if (s.mode !== 'modeselector') {
    return { cw: 0, ccw: 0, sw: 0 };
  }
  const cur = s.signals[s.selected] || s.signals[0];
  const values = {
    index: s.selected + 1,
    name: cur?.name || '',
    value: cur?.value || 0,
    sw: 0,
  };
  s.signals.forEach((sig, i) => {
    values[`sig/${i + 1}`] = sig.value;
  });
  return values;
}

/** dir: +1 clockwise, -1 counter-clockwise. Mutates a copy of settings. */
export function applyEncoderTurn(settings, dir) {
  const s = normalizeEncoderSettings(settings);
  const step = dir < 0 ? -1 : 1;
  if (s.mode === 'raw') {
    return { settings: s, kind: step > 0 ? 'cw' : 'ccw' };
  }
  const i = s.selected;
  const sig = s.signals[i];
  const ticks = Math.round(sig.value * sig.steps) + step;
  const next = Math.max(0, Math.min(sig.steps, ticks));
  s.signals[i] = { ...sig, value: next / sig.steps };
  return {
    settings: s,
    kind: 'value',
    index: i,
    name: sig.name,
    value: s.signals[i].value,
  };
}

/** Switch press. RAW = trigger. MODESELECTOR = next signal + send name. */
export function applyEncoderSwitch(settings) {
  const s = normalizeEncoderSettings(settings);
  if (s.mode === 'raw') {
    return { settings: s, kind: 'sw' };
  }
  s.selected = (s.selected + 1) % s.signals.length;
  const cur = s.signals[s.selected];
  return {
    settings: s,
    kind: 'select',
    index: s.selected,
    name: cur.name,
    value: cur.value,
  };
}

export function roundEncoder(v) {
  return Math.round(clamp01(v) * 1000) / 1000;
}
