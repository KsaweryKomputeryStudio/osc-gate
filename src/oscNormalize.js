/**
 * Normalize DualSense HID state → OSC floats in [0, 1].
 *
 * Conventions:
 *   buttons / digital   → 0 or 1
 *   sticks / triggers   → 0..1 (sticks: 0.5 = center, 0 = left/up, 1 = right/down)
 *   touch coords        → 0..1 over pad surface (1920×1080)
 *   gyro / accel        → 0..1 over full int16 range (0.5 ≈ rest)
 *   battery             → 0..1
 *   adaptive state      → 0..1 (state/15)
 */

const TOUCH_W = 1920;
const TOUCH_H = 1080;
const INT16_MIN = -32768;
const INT16_SPAN = 65535;

/** Stick rest deadzone around 0.5 (filters LSB noise when idle). */
const STICK_DEADZONE = 0.025;
/** Trigger rest deadzone near 0. */
const TRIGGER_DEADZONE = 0.02;
/** Quantize continuous floats to reduce micro-jitter. */
const QUANT = 1000;

export const OSC_PREFIX = '/ds';

function clamp01(v) {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function bool01(v) {
  return v ? 1 : 0;
}

function quantize(v) {
  return Math.round(clamp01(v) * QUANT) / QUANT;
}

/** Raw HID stick byte 0..255 → 0..1 with center deadzone → 0.5 */
export function stick01(raw) {
  let v = clamp01(raw / 0xff);
  if (Math.abs(v - 0.5) < STICK_DEADZONE) return 0.5;
  return quantize(v);
}

/** Raw trigger byte 0..255 → 0..1 with rest deadzone → 0 */
export function trigger01(raw) {
  let v = clamp01(raw / 0xff);
  if (v < TRIGGER_DEADZONE) return 0;
  return quantize(v);
}

/** Signed int16 → 0..1 */
export function int1601(v) {
  return quantize(clamp01((v - INT16_MIN) / INT16_SPAN));
}

export function touchX01(x) {
  return quantize(clamp01(x / (TOUCH_W - 1)));
}

export function touchY01(y) {
  return quantize(clamp01(y / (TOUCH_H - 1)));
}

/**
 * Build a flat list of OSC messages from a parsed DualSense state.
 * Keeps the address set lean (no duplicate compound + component pairs)
 * so one frame stays small enough for a single UDP OSC bundle.
 *
 * @param {object} state
 * @param {{ ignoreImu?: boolean }} [options]
 * @returns {{ address: string, args: number[] }[]}
 */
export function stateToOscMessages(state, options = {}) {
  const { ignoreImu = false } = options;
  const p = OSC_PREFIX;
  const msgs = [];
  const push = (address, ...args) => msgs.push({ address, args: args.map((a) => Number(a)) });

  // --- buttons (0|1) ---
  if (state.buttons) {
    const b = state.buttons;
    push(`${p}/button/cross`, bool01(b.cross));
    push(`${p}/button/circle`, bool01(b.circle));
    push(`${p}/button/square`, bool01(b.square));
    push(`${p}/button/triangle`, bool01(b.triangle));
    push(`${p}/button/l1`, bool01(b.l1));
    push(`${p}/button/r1`, bool01(b.r1));
    push(`${p}/button/l2`, bool01(b.l2));
    push(`${p}/button/r2`, bool01(b.r2));
    push(`${p}/button/l3`, bool01(b.l3));
    push(`${p}/button/r3`, bool01(b.r3));
    push(`${p}/button/create`, bool01(b.create));
    push(`${p}/button/options`, bool01(b.options));
    push(`${p}/button/ps`, bool01(b.ps));
    push(`${p}/button/touchpad`, bool01(b.touchpad));
    push(`${p}/button/mute`, bool01(b.mute));
    push(`${p}/dpad/up`, bool01(b.dpad.up));
    push(`${p}/dpad/down`, bool01(b.dpad.down));
    push(`${p}/dpad/left`, bool01(b.dpad.left));
    push(`${p}/dpad/right`, bool01(b.dpad.right));
  }

  // --- sticks (components only) ---
  if (state.sticks) {
    push(`${p}/stick/left/x`, stick01(state.sticks.left.x));
    push(`${p}/stick/left/y`, stick01(state.sticks.left.y));
    push(`${p}/stick/right/x`, stick01(state.sticks.right.x));
    push(`${p}/stick/right/y`, stick01(state.sticks.right.y));
  }

  // --- analog triggers ---
  if (state.triggers) {
    push(`${p}/trigger/l2/value`, trigger01(state.triggers.l2));
    push(`${p}/trigger/r2/value`, trigger01(state.triggers.r2));
  }

  // --- touchpad (only while active, plus active flag) ---
  if (state.touch) {
    state.touch.forEach((t, i) => {
      push(`${p}/touch/${i}/active`, bool01(t.active));
      if (t.active) {
        push(`${p}/touch/${i}/x`, touchX01(t.x));
        push(`${p}/touch/${i}/y`, touchY01(t.y));
      }
    });
  } else {
    push(`${p}/touch/0/active`, 0);
    push(`${p}/touch/1/active`, 0);
  }

  // --- motion (gyro + accel = IMU) ---
  if (!ignoreImu) {
    if (state.gyro) {
      push(`${p}/gyro/x`, int1601(state.gyro.x));
      push(`${p}/gyro/y`, int1601(state.gyro.y));
      push(`${p}/gyro/z`, int1601(state.gyro.z));
    }
    if (state.accel) {
      push(`${p}/accel/x`, int1601(state.accel.x));
      push(`${p}/accel/y`, int1601(state.accel.y));
      push(`${p}/accel/z`, int1601(state.accel.z));
    }
  }

  // --- battery (rarely changes) ---
  if (state.battery) {
    push(`${p}/battery/level`, quantize(clamp01(state.battery.level / 100)));
    push(`${p}/battery/charging`, bool01(state.battery.charging));
  }

  push(`${p}/connected`, 1);

  return msgs;
}

/**
 * Apply an inbound OSC control message to a DualSenseDevice.
 * All numeric control args expected in [0, 1] unless noted.
 *
 * @returns {boolean} true if handled
 */
export function applyOscControl(controller, address, args) {
  if (!controller) return false;

  const values = (args || []).map((a) => (typeof a === 'object' && a != null ? a.value : a));
  const f = (i, def = 0) => {
    const v = Number(values[i]);
    return Number.isFinite(v) ? v : def;
  };
  const s = (i, def = '') => {
    const v = values[i];
    return v == null ? def : String(v);
  };
  const toByte = (v) => Math.round(clamp01(v) * 255);

  const p = OSC_PREFIX;

  if (address === `${p}/rumble` || address === `${p}/haptics`) {
    controller.setRumble(toByte(f(0)), toByte(f(1, f(0))));
    return true;
  }
  if (address === `${p}/rumble/left` || address === `${p}/haptics/left`) {
    controller.setRumble(toByte(f(0)), controller.output.motorRight);
    return true;
  }
  if (address === `${p}/rumble/right` || address === `${p}/haptics/right`) {
    controller.setRumble(controller.output.motorLeft, toByte(f(0)));
    return true;
  }
  if (address === `${p}/rumble/stop` || address === `${p}/haptics/stop`) {
    controller.setRumble(0, 0);
    return true;
  }

  if (address === `${p}/lightbar`) {
    controller.setLightbar(toByte(f(0)), toByte(f(1)), toByte(f(2)));
    return true;
  }
  if (address === `${p}/lightbar/r`) {
    const { g, b } = controller.output.lightbar;
    controller.setLightbar(toByte(f(0)), g, b);
    return true;
  }
  if (address === `${p}/lightbar/g`) {
    const { r, b } = controller.output.lightbar;
    controller.setLightbar(r, toByte(f(0)), b);
    return true;
  }
  if (address === `${p}/lightbar/b`) {
    const { r, g } = controller.output.lightbar;
    controller.setLightbar(r, g, toByte(f(0)));
    return true;
  }

  if (address === `${p}/playerleds`) {
    if (values.length >= 5) {
      let mask = 0;
      for (let i = 0; i < 5; i++) {
        if (f(i) >= 0.5) mask |= 1 << i;
      }
      controller.setPlayerLeds(mask);
    } else {
      controller.setPlayerLeds(Math.round(clamp01(f(0)) * 31) & 0x1f);
    }
    return true;
  }

  if (address === `${p}/mute`) {
    controller.setMuteLed(f(0) >= 0.5);
    return true;
  }

  const presetMatch = address.match(/^\/ds\/trigger\/(l2|r2)\/preset$/);
  if (presetMatch) {
    const side = presetMatch[1];
    const name = s(0, 'off').toLowerCase();
    controller.setTriggerEffect(side, name);
    return true;
  }

  const effectMatch = address.match(/^\/ds\/trigger\/(l2|r2)\/effect$/);
  if (effectMatch) {
    const side = effectMatch[1];
    const scale = (v) => (v > 1 ? Math.round(Math.min(255, v)) : toByte(v));
    const mode = scale(f(0));
    const params = [];
    for (let i = 1; i <= 7; i++) params.push(scale(f(i)));
    controller.setTriggerEffectCustom(side, mode, params);
    return true;
  }

  const sideMatch = address.match(/^\/ds\/trigger\/(l2|r2)$/);
  if (sideMatch) {
    const side = sideMatch[1];
    if (typeof values[0] === 'string') {
      controller.setTriggerEffect(side, s(0).toLowerCase());
    } else if (f(0) <= 0) {
      controller.setTriggerEffect(side, 'off');
    } else {
      const strength = toByte(f(0));
      controller.setTriggerEffectCustom(side, 0x01, [0x00, strength, 0, 0, 0, 0, 0]);
    }
    return true;
  }

  return false;
}
