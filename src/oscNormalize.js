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

export const OSC_PREFIX = '/ds';

function clamp01(v) {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function bool01(v) {
  return v ? 1 : 0;
}

/** Raw HID stick byte 0..255 → 0..1 (0.5 ≈ center) */
export function stick01(raw) {
  return clamp01(raw / 0xff);
}

/** Raw trigger byte 0..255 → 0..1 */
export function trigger01(raw) {
  return clamp01(raw / 0xff);
}

/** Signed int16 → 0..1 */
export function int1601(v) {
  return clamp01((v - INT16_MIN) / INT16_SPAN);
}

export function touchX01(x) {
  return clamp01(x / (TOUCH_W - 1));
}

export function touchY01(y) {
  return clamp01(y / (TOUCH_H - 1));
}

/**
 * Build a flat list of OSC messages from a parsed DualSense state.
 * @param {object} state
 * @param {{ ignoreAccel?: boolean }} [options]
 * @returns {{ address: string, args: number[] }[]}
 */
export function stateToOscMessages(state, options = {}) {
  const { ignoreAccel = false } = options;
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
    // hat as 0..1 (8-way + rest): 0=N … 7=NW, 8=rest → /8
    push(`${p}/dpad/hat`, clamp01(b.dpad.value / 8));
  }

  // --- sticks ---
  if (state.sticks) {
    push(`${p}/stick/left/x`, stick01(state.sticks.left.x));
    push(`${p}/stick/left/y`, stick01(state.sticks.left.y));
    push(`${p}/stick/right/x`, stick01(state.sticks.right.x));
    push(`${p}/stick/right/y`, stick01(state.sticks.right.y));
    push(
      `${p}/stick/left`,
      stick01(state.sticks.left.x),
      stick01(state.sticks.left.y),
    );
    push(
      `${p}/stick/right`,
      stick01(state.sticks.right.x),
      stick01(state.sticks.right.y),
    );
  }

  // --- analog triggers (pressure) ---
  // Use /value so /ds/trigger/l2 stays free for inbound control commands.
  if (state.triggers) {
    push(`${p}/trigger/l2/value`, trigger01(state.triggers.l2));
    push(`${p}/trigger/r2/value`, trigger01(state.triggers.r2));
  }

  // --- touchpad ---
  if (state.touch) {
    state.touch.forEach((t, i) => {
      push(`${p}/touch/${i}/active`, bool01(t.active));
      push(`${p}/touch/${i}/id`, clamp01(t.id / 127));
      push(`${p}/touch/${i}/x`, t.active ? touchX01(t.x) : 0);
      push(`${p}/touch/${i}/y`, t.active ? touchY01(t.y) : 0);
      if (t.active) {
        push(`${p}/touch/${i}`, touchX01(t.x), touchY01(t.y));
      }
    });
  } else {
    for (let i = 0; i < 2; i++) {
      push(`${p}/touch/${i}/active`, 0);
      push(`${p}/touch/${i}/x`, 0);
      push(`${p}/touch/${i}/y`, 0);
    }
  }

  // --- motion ---
  if (state.gyro) {
    push(`${p}/gyro/x`, int1601(state.gyro.x));
    push(`${p}/gyro/y`, int1601(state.gyro.y));
    push(`${p}/gyro/z`, int1601(state.gyro.z));
    push(`${p}/gyro`, int1601(state.gyro.x), int1601(state.gyro.y), int1601(state.gyro.z));
  } else {
    push(`${p}/gyro/x`, 0.5);
    push(`${p}/gyro/y`, 0.5);
    push(`${p}/gyro/z`, 0.5);
  }

  if (!ignoreAccel) {
    if (state.accel) {
      push(`${p}/accel/x`, int1601(state.accel.x));
      push(`${p}/accel/y`, int1601(state.accel.y));
      push(`${p}/accel/z`, int1601(state.accel.z));
      push(`${p}/accel`, int1601(state.accel.x), int1601(state.accel.y), int1601(state.accel.z));
    } else {
      push(`${p}/accel/x`, 0.5);
      push(`${p}/accel/y`, 0.5);
      push(`${p}/accel/z`, 0.5);
    }
  }

  // --- adaptive trigger feedback ---
  if (state.adaptiveTriggers) {
    const { l2, r2 } = state.adaptiveTriggers;
    push(`${p}/adaptive/l2/force`, bool01(l2.force));
    push(`${p}/adaptive/l2/state`, clamp01(l2.state / 15));
    push(`${p}/adaptive/r2/force`, bool01(r2.force));
    push(`${p}/adaptive/r2/state`, clamp01(r2.state / 15));
  }

  // --- battery ---
  if (state.battery) {
    push(`${p}/battery/level`, clamp01(state.battery.level / 100));
    push(`${p}/battery/charging`, bool01(state.battery.charging));
    push(`${p}/battery/full`, bool01(state.battery.full));
  }

  // --- meta ---
  push(`${p}/connected`, 1);
  if (state.sensorTimestamp != null) {
    // wrap uint32 into 0..1 for consumers that want a phase signal
    push(`${p}/sensor/timestamp`, clamp01((state.sensorTimestamp >>> 0) / 0xffffffff));
  }

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
    // either one float bitmask 0..1 → 0..31, or five 0/1 args
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

  // Adaptive trigger presets: /ds/trigger/l2/preset "rigid"
  const presetMatch = address.match(/^\/ds\/trigger\/(l2|r2)\/preset$/);
  if (presetMatch) {
    const side = presetMatch[1];
    const name = s(0, 'off').toLowerCase();
    controller.setTriggerEffect(side, name);
    return true;
  }

  // Custom effect: /ds/trigger/l2/effect mode p1..p7
  // mode & params are 0..1 → scaled to 0..255 (mode often small ints; also accept raw if >1)
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

  // Shorthand preset on main path: /ds/trigger/l2 "pulse"  OR /ds/trigger/l2 0..1 intensity→rigid strength
  const sideMatch = address.match(/^\/ds\/trigger\/(l2|r2)$/);
  if (sideMatch) {
    const side = sideMatch[1];
    if (typeof values[0] === 'string') {
      controller.setTriggerEffect(side, s(0).toLowerCase());
    } else if (f(0) <= 0) {
      controller.setTriggerEffect(side, 'off');
    } else {
      // strength 0..1 → rigid resistance
      const strength = toByte(f(0));
      controller.setTriggerEffectCustom(side, 0x01, [0x00, strength, 0, 0, 0, 0, 0]);
    }
    return true;
  }

  return false;
}
