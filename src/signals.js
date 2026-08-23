/**
 * Per-instance outgoing signal modes: off / raw / auto / manual.
 * Missing keys default to raw (on).
 */

import { loadConfig } from './config.js';
import { instanceAddress, instancePrefix, sourceType } from './sourceCatalog.js';
import { getInstance, patchInstance } from './session.js';
import { TIME_FIELDS } from './timeSource.js';
import { WEATHER_FIELDS } from './weatherSource.js';
import { midiSignalRows } from './midiSource.js';
import { gamepadSignalRows } from './gamepadSource.js';
import { scale01 } from './oscInScale.js';

const listeners = new Set();
const observed = new Map();

export function onSignalsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(id) {
  listeners.forEach((fn) => fn(id));
}

export function signalKey(inst, address) {
  const addr = String(address || '');
  if (!addr) return '';
  const prefix = inst ? instancePrefix(inst) : '';
  if (prefix && (addr === prefix || addr.startsWith(`${prefix}/`))) {
    return addr.slice(prefix.length + (addr === prefix ? 0 : 1));
  }
  const spec = sourceType(inst?.type);
  if (spec?.prefix && (addr === spec.prefix || addr.startsWith(`${spec.prefix}/`))) {
    return addr.slice(spec.prefix.length + (addr === spec.prefix ? 0 : 1));
  }
  return addr.replace(/^\//, '');
}

export function normalizeSignalSpec(v) {
  if (v === false || v === 'off') return { mode: 'off', min: 0, max: 1 };
  if (v === true || v == null || v === 'raw') return { mode: 'raw', min: 0, max: 1 };
  if (typeof v === 'object') {
    let mode = v.mode;
    if (mode === 'auto01') mode = 'auto';
    if (mode === 'man01' || mode === 'man') mode = 'manual';
    if (!['off', 'raw', 'auto', 'manual'].includes(mode)) mode = 'raw';
    let min = Number(v.min);
    let max = Number(v.max);
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 1;
    return { mode, min, max };
  }
  return { mode: 'raw', min: 0, max: 1 };
}

export function getSignalSpec(inst, addressOrKey) {
  if (!inst) return normalizeSignalSpec(null);
  const key = String(addressOrKey || '').includes('/') ? signalKey(inst, addressOrKey) : addressOrKey;
  const map = inst.signals || {};
  return normalizeSignalSpec(map[key] ?? map[addressOrKey]);
}

export function isSignalOn(inst, address) {
  return getSignalSpec(inst, address).mode !== 'off';
}

export function setSignalSpec(id, key, patch) {
  const inst = getInstance(id);
  if (!inst || !key) return inst;
  const nextSpec = normalizeSignalSpec({ ...getSignalSpec(inst, key), ...patch });
  const next = patchInstance(id, { signals: { ...(inst.signals || {}), [key]: nextSpec } });
  notify(id);
  return next;
}

export function setSignalEnabled(id, key, on) {
  return setSignalSpec(id, key, { mode: on ? 'raw' : 'off' });
}

function obsMap(instId) {
  if (!observed.has(instId)) observed.set(instId, new Map());
  return observed.get(instId);
}

export function observeSignal(instId, key, n) {
  if (!Number.isFinite(n)) return null;
  const map = obsMap(instId);
  const prev = map.get(key);
  const next = prev
    ? { min: n < prev.min ? n : prev.min, max: n > prev.max ? n : prev.max }
    : { min: n, max: n };
  map.set(key, next);
  return next;
}

export function signalObserved(instId, key) {
  return obsMap(instId).get(key) || null;
}

export function resetSignalObserved(instId, key) {
  obsMap(instId).delete(key);
  notify(instId);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

export function mapOutgoingValue(inst, key, raw) {
  const spec = getSignalSpec(inst, key);
  const n = Number(raw);
  if (!Number.isFinite(n) || spec.mode === 'off') return null;
  if (spec.mode === 'auto') {
    const obs = signalObserved(inst?.id, key);
    return round6(scale01(n, obs?.min, obs?.max));
  }
  if (spec.mode === 'manual') {
    return round6(scale01(n, spec.min, spec.max));
  }
  return n;
}

export function processOutgoing(inst, messages) {
  const sent = [];
  const shown = [];
  if (!inst) return { sent: messages || [], shown: messages || [] };
  for (const m of messages || []) {
    const key = signalKey(inst, m.address);
    const spec = getSignalSpec(inst, key);
    const raw = Number(m.args?.[0]);
    if (Number.isFinite(raw)) observeSignal(inst.id, key, raw);
    const out = mapOutgoingValue(inst, key, raw);
    if (spec.mode === 'off') {
      shown.push({ ...m, args: Number.isFinite(raw) ? [raw] : m.args, raw, out: null });
      continue;
    }
    const args = Number.isFinite(out) ? [out] : m.args;
    shown.push({ ...m, args, raw, out: Number.isFinite(out) ? out : null });
    sent.push({ address: m.address, args });
  }
  return { sent, shown };
}

const VIEW_SIGNALS = {
  time: TIME_FIELDS.map((f) => ({ key: f.id, label: f.label })),
  weather: WEATHER_FIELDS.map((f) => ({
    key: f.address.replace(/^\/weather\//, ''),
    label: f.label,
  })),
  mic: [
    { key: 'level', label: 'Level' },
    { key: 'peak', label: 'Peak' },
  ],
  human: [
    { key: 'count', label: 'Count' },
    { key: 'present', label: 'Present' },
  ],
  garmin: [
    { key: 'hr', label: 'Heart rate' },
    { key: 'trend', label: 'Trend' },
    { key: 'push_beat', label: 'Beat' },
  ],
  macbook: [
    { key: 'lid/angle', label: 'Lid angle' },
    { key: 'lid/open', label: 'Lid open' },
    { key: 'lid/norm', label: 'Lid 0–1' },
    { key: 'accel/x', label: 'Accel X' },
    { key: 'accel/y', label: 'Accel Y' },
    { key: 'accel/z', label: 'Accel Z' },
    { key: 'gyro/x', label: 'Gyro X' },
    { key: 'gyro/y', label: 'Gyro Y' },
    { key: 'gyro/z', label: 'Gyro Z' },
    { key: 'als', label: 'Ambient light' },
  ],
  controller: [
    'button/cross',
    'button/circle',
    'button/square',
    'button/triangle',
    'button/l1',
    'button/r1',
    'button/l2',
    'button/r2',
    'button/l3',
    'button/r3',
    'button/create',
    'button/options',
    'button/ps',
    'button/touchpad',
    'button/mute',
    'dpad/up',
    'dpad/down',
    'dpad/left',
    'dpad/right',
    'stick/left/x',
    'stick/left/y',
    'stick/right/x',
    'stick/right/y',
    'trigger/l2/value',
    'trigger/r2/value',
    'touch/0/active',
    'touch/1/active',
    'gyro/x',
    'gyro/y',
    'gyro/z',
    'accel/x',
    'accel/y',
    'accel/z',
    'battery/level',
    'battery/charging',
    'connected',
  ].map((key) => ({ key, label: key })),
};

export function defaultSignalMode() {
  const mode = loadConfig().signals?.defaultMode;
  return mode === 'off' || mode === 'auto' ? mode : 'raw';
}

export function seedInstanceSignals(inst) {
  if (!inst) return inst;
  const mode = defaultSignalMode();
  if (mode === 'raw') return inst;
  const signals = {};
  for (const row of listKnownSignals(inst)) {
    signals[row.key] = { mode, min: 0, max: 1 };
  }
  return patchInstance(inst.id, { signals });
}

export function listKnownSignals(inst) {
  if (!inst) return [];
  const spec = sourceType(inst.type);
  if (spec?.kind === 'poll') {
    return (spec.fields || []).map((f) => ({
      key: f.id,
      address: instanceAddress(inst, f.id),
      label: f.label,
    }));
  }
  const viewRows =
    inst.type === 'midi' ? midiSignalRows(inst) : inst.type === 'gamepad' ? gamepadSignalRows(inst) : VIEW_SIGNALS[inst.type] || [];
  return viewRows.map((s) => ({
    key: s.key,
    address: `${instancePrefix(inst)}/${s.key}`,
    label: s.label,
  }));
}
