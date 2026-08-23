/**
 * Browser Gamepad API → DualSense-like stick / button / trigger signals.
 * DualSense pads are left to the DualSense (WebHID) source.
 */

export const GAMEPAD_CORE_SIGNALS = [
  { key: 'button/a', label: 'A / cross' },
  { key: 'button/b', label: 'B / circle' },
  { key: 'button/x', label: 'X / square' },
  { key: 'button/y', label: 'Y / triangle' },
  { key: 'button/l1', label: 'L1' },
  { key: 'button/r1', label: 'R1' },
  { key: 'button/l2', label: 'L2 click' },
  { key: 'button/r2', label: 'R2 click' },
  { key: 'button/select', label: 'Select' },
  { key: 'button/start', label: 'Start' },
  { key: 'button/l3', label: 'L3' },
  { key: 'button/r3', label: 'R3' },
  { key: 'button/home', label: 'Home' },
  { key: 'dpad/up', label: 'D-pad up' },
  { key: 'dpad/down', label: 'D-pad down' },
  { key: 'dpad/left', label: 'D-pad left' },
  { key: 'dpad/right', label: 'D-pad right' },
  { key: 'stick/left/x', label: 'Left stick X' },
  { key: 'stick/left/y', label: 'Left stick Y' },
  { key: 'stick/right/x', label: 'Right stick X' },
  { key: 'stick/right/y', label: 'Right stick Y' },
  { key: 'trigger/l2', label: 'L2 analog' },
  { key: 'trigger/r2', label: 'R2 analog' },
  { key: 'connected', label: 'Connected' },
];

const FACE = ['button/a', 'button/b', 'button/x', 'button/y'];
const BUMP = ['button/l1', 'button/r1', 'button/l2', 'button/r2'];
const MENU = ['button/select', 'button/start', 'button/l3', 'button/r3'];
const DPAD = ['dpad/up', 'dpad/down', 'dpad/left', 'dpad/right'];

export function isDualSenseGamepad(gp) {
  const id = String(gp?.id || '');
  if (/dualsense/i.test(id)) return true;
  return /054c/i.test(id) && /0ce6|0df2/i.test(id);
}

export function gamepadSignalRows(inst) {
  const extraBtn = Math.max(17, Number(inst?.settings?.buttonCount) || 17);
  const extraAxis = Math.max(4, Number(inst?.settings?.axisCount) || 4);
  const rows = [...GAMEPAD_CORE_SIGNALS];
  for (let i = 17; i < extraBtn; i += 1) rows.push({ key: `button/${i}`, label: `Button ${i}` });
  for (let i = 4; i < extraAxis; i += 1) rows.push({ key: `axis/${i}`, label: `Axis ${i}` });
  return rows;
}

export function listGamepads({ includeDualSense = false } = {}) {
  if (!navigator.getGamepads) return [];
  return [...navigator.getGamepads()].filter(Boolean).flatMap((gp, i) => {
    if (!includeDualSense && isDualSenseGamepad(gp)) return [];
    return [
      {
        index: gp.index ?? i,
        id: gp.id,
        name: gp.id || `Gamepad ${gp.index ?? i}`,
        mapping: gp.mapping || '',
        buttons: gp.buttons?.length || 0,
        axes: gp.axes?.length || 0,
      },
    ];
  });
}

function btn(gp, i) {
  const b = gp.buttons?.[i];
  if (!b) return { pressed: 0, value: 0 };
  return { pressed: b.pressed ? 1 : 0, value: clamp01(Number(b.value) || (b.pressed ? 1 : 0)) };
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function axis01(v, deadzone) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = 0;
  if (Math.abs(n) < deadzone) n = 0;
  return clamp01((n + 1) / 2);
}

export function readGamepad(gp, { deadzone = 0.08 } = {}) {
  const dz = Math.max(0, Math.min(0.4, Number(deadzone) || 0));
  const values = { connected: gp ? 1 : 0 };
  if (!gp) return values;

  FACE.forEach((key, i) => {
    values[key] = btn(gp, i).pressed;
  });
  BUMP.forEach((key, i) => {
    values[key] = btn(gp, 4 + i).pressed;
  });
  MENU.forEach((key, i) => {
    values[key] = btn(gp, 8 + i).pressed;
  });
  values['button/home'] = btn(gp, 16).pressed;
  DPAD.forEach((key, i) => {
    values[key] = btn(gp, 12 + i).pressed;
  });

  const lx = axis01(gp.axes?.[0], dz);
  const ly = axis01(-(gp.axes?.[1] ?? 0), dz);
  const rx = axis01(gp.axes?.[2], dz);
  const ry = axis01(-(gp.axes?.[3] ?? 0), dz);
  values['stick/left/x'] = lx;
  values['stick/left/y'] = ly;
  values['stick/right/x'] = rx;
  values['stick/right/y'] = ry;
  values['trigger/l2'] = btn(gp, 6).value;
  values['trigger/r2'] = btn(gp, 7).value;

  const nBtn = gp.buttons?.length || 0;
  const nAxis = gp.axes?.length || 0;
  for (let i = 17; i < nBtn; i += 1) values[`button/${i}`] = btn(gp, i).pressed;
  for (let i = 4; i < nAxis; i += 1) values[`axis/${i}`] = axis01(gp.axes[i], dz);

  values._buttonCount = nBtn;
  values._axisCount = nAxis;
  values._lx = (lx - 0.5) * 2;
  values._ly = (ly - 0.5) * 2;
  values._rx = (rx - 0.5) * 2;
  values._ry = (ry - 0.5) * 2;
  return values;
}

function matchPad(pads, { id, index }) {
  if (id) {
    const byId = pads.find((p) => p.id === id);
    if (byId) return byId;
  }
  if (index != null && index >= 0) {
    return pads.find((p) => p.index === index) || null;
  }
  return null;
}

export class GamepadSource {
  constructor({ onValues, onStatus } = {}) {
    this.onValues = onValues || (() => {});
    this.onStatus = onStatus || (() => {});
    this.connected = false;
    this.waiting = false;
    this.gamepadId = '';
    this.gamepadIndex = -1;
    this.gamepadName = '';
    this.deadzone = 0.08;
    this.values = {};
    this._want = false;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  setDeadzone(n) {
    this.deadzone = Math.max(0, Math.min(0.4, Number(n) || 0));
  }

  connect({ id = '', index = -1 } = {}) {
    if (!GamepadSource.isSupported()) throw new Error('Gamepad API is not available in this browser');
    this._want = true;
    this.gamepadId = id;
    this.gamepadIndex = Number.isFinite(Number(index)) ? Number(index) : -1;
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    const gp = matchPad(pads, { id: this.gamepadId, index: this.gamepadIndex });
    if (gp) {
      this.waiting = false;
      this._bind(gp);
      return { id: gp.id, index: gp.index, name: gp.id };
    }
    this.waiting = true;
    this.connected = false;
    this.onStatus({ connecting: true, connected: false, waiting: true });
    return null;
  }

  disconnect() {
    this._want = false;
    this.waiting = false;
    this.connected = false;
    this.values = { connected: 0 };
    this.onValues({ ...this.values });
    this.onStatus({ connecting: false, connected: false, name: this.gamepadName });
  }

  poll(pads) {
    if (!this._want) return;
    const list = pads || [...(navigator.getGamepads?.() || [])].filter(Boolean);
    let gp = matchPad(list, { id: this.gamepadId, index: this.gamepadIndex });
    if (!gp && this.waiting) {
      gp = list.find((p) => !isDualSenseGamepad(p)) || null;
      if (gp) {
        this.gamepadId = gp.id;
        this.gamepadIndex = gp.index;
      }
    }
    if (!gp) {
      if (this.connected) {
        this.connected = false;
        this.values = { connected: 0 };
        this.onValues({ ...this.values });
        this.onStatus({
          connecting: this.waiting,
          connected: false,
          waiting: this.waiting,
          name: this.gamepadName,
        });
      }
      return;
    }
    if (!this.connected || this.waiting) this._bind(gp);
    this.values = readGamepad(gp, { deadzone: this.deadzone });
    this.onValues(this.values);
  }

  _bind(gp) {
    this.connected = true;
    this.waiting = false;
    this.gamepadId = gp.id;
    this.gamepadIndex = gp.index;
    this.gamepadName = gp.id || `Gamepad ${gp.index}`;
    this.onStatus({
      connecting: false,
      connected: true,
      waiting: false,
      name: this.gamepadName,
      id: gp.id,
      index: gp.index,
      buttonCount: gp.buttons?.length || 0,
      axisCount: gp.axes?.length || 0,
    });
  }
}

const hubSources = new Map();
let hubRaf = 0;

function hubTick() {
  hubRaf = requestAnimationFrame(hubTick);
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  for (const src of hubSources.values()) src.poll(pads);
}

export function bindGamepadSource(id, source) {
  hubSources.set(id, source);
  if (!hubRaf) hubRaf = requestAnimationFrame(hubTick);
}

export function unbindGamepadSource(id) {
  hubSources.delete(id);
  if (!hubSources.size && hubRaf) {
    cancelAnimationFrame(hubRaf);
    hubRaf = 0;
  }
}
