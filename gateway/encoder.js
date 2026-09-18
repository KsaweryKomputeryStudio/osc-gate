/**
 * KY-040-style rotary encoder + switch on Raspberry Pi GPIO.
 *
 * Backends (first that works):
 *   1. pinctrl poll  — Raspberry Pi OS, Pi 4/5, no native addon
 *   2. onoff         — sysfs / epoll, optional `npm i onoff`
 *
 * Quadrature is decoded to one detent per click (4 gray-code steps).
 * Switch is active-low with debounce.
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const ENC_TABLE = [0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0];
const DETENT = 4;
const SW_DEBOUNCE_MS = 40;
const MAX_PIN = 27;

function which(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasPinctrl() {
  return existsSync('/usr/bin/pinctrl') || which('pinctrl');
}

function onoffModule() {
  try {
    const require = createRequire(import.meta.url);
    return require('onoff');
  } catch {
    return null;
  }
}

export function probeEncoder() {
  if (hasPinctrl()) {
    return { available: true, backend: 'pinctrl', gpio: true };
  }
  const onoff = onoffModule();
  if (onoff?.Gpio?.accessible) {
    return { available: true, backend: 'onoff', gpio: true };
  }
  const gpio = existsSync('/dev/gpiochip0') || existsSync('/sys/class/gpio');
  if (onoff && !onoff.Gpio?.accessible) {
    return {
      available: false,
      backend: '',
      gpio: true,
      error: 'onoff loaded but GPIO is not accessible. Add this user to the gpio group and re-login.',
    };
  }
  if (gpio) {
    return {
      available: false,
      backend: '',
      gpio: true,
      error: 'GPIO found. Use Raspberry Pi OS (pinctrl) or: npm i onoff',
    };
  }
  return {
    available: false,
    backend: '',
    gpio: false,
    error: 'No GPIO on this machine. Run the gateway on a Raspberry Pi.',
  };
}

function clampPin(n) {
  const v = Math.round(Number(n));
  if (!Number.isInteger(v) || v < 0 || v > MAX_PIN) return null;
  return v;
}

function parsePins(opts) {
  const clk = clampPin(opts.clk);
  const dt = clampPin(opts.dt);
  const sw = clampPin(opts.sw);
  if (clk == null || dt == null || sw == null) {
    throw new Error('CLK, DT, and SW must be BCM GPIO 0–27');
  }
  if (new Set([clk, dt, sw]).size !== 3) {
    throw new Error('CLK, DT, and SW must be three different pins');
  }
  return { clk, dt, sw, invert: !!opts.invert };
}

function runPinctrl(args) {
  execFileSync('pinctrl', args, { encoding: 'utf8', timeout: 2000 });
}

function readPinctrlLevels(pins) {
  const out = execFileSync('pinctrl', ['get', pins.join(',')], {
    encoding: 'utf8',
    timeout: 2000,
  });
  const levels = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d+)\s*:.*\|\s*(hi|lo)/i);
    if (m) levels[Number(m[1])] = m[2].toLowerCase() === 'hi' ? 1 : 0;
  }
  return levels;
}

function spawnPinctrlPoll(pins) {
  const list = pins.join(',');
  const spaced = pins.map(String);
  const tries = [
    ['stdbuf', ['-oL', 'pinctrl', 'poll', list]],
    ['stdbuf', ['-oL', 'pinctrl', 'poll', ...spaced]],
    ['pinctrl', ['poll', list]],
    ['pinctrl', ['poll', ...spaced]],
  ];
  let lastErr = null;
  for (const [cmd, args] of tries) {
    if (cmd === 'stdbuf' && !which('stdbuf')) continue;
    try {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (child.pid) return child;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not start pinctrl poll');
}

class EncoderWatcher {
  constructor(id, opts, { onEvent, onStatus }) {
    this.id = id;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.pins = parsePins(opts);
    this.clk = 1;
    this.dt = 1;
    this.sw = 1;
    this.prev = 0b11;
    this.acc = 0;
    this._child = null;
    this._gpios = [];
    this._rl = null;
    this._swIgnoreUntil = 0;
    this._swHeld = false;
    this._stopped = false;
    this.backend = '';
  }

  async start() {
    const probe = probeEncoder();
    if (!probe.available) throw new Error(probe.error || 'GPIO unavailable');

    this.onStatus({ id: this.id, connected: false, connecting: true, backend: probe.backend });

    if (probe.backend === 'pinctrl') {
      this.backend = 'pinctrl';
      await this._startPinctrl();
    } else {
      this.backend = 'onoff';
      await this._startOnoff();
    }

    if (this._stopped) {
      this.stop();
      return;
    }

    this.onStatus({
      id: this.id,
      connected: true,
      connecting: false,
      backend: this.backend,
      pins: this.pins,
    });
  }

  async _startPinctrl() {
    const { clk, dt, sw } = this.pins;
    try {
      runPinctrl(['set', `${clk},${dt},${sw}`, 'ip', 'pu']);
    } catch (err) {
      throw new Error(`pinctrl set failed: ${err.message}`);
    }
    const levels = readPinctrlLevels([clk, dt, sw]);
    this.clk = levels[clk] ?? 1;
    this.dt = levels[dt] ?? 1;
    this.sw = levels[sw] ?? 1;
    this.prev = ((this.clk & 1) << 1) | (this.dt & 1);

    this._child = spawnPinctrlPoll([clk, dt, sw]);
    this._child.on('error', (err) => {
      if (!this._stopped) this.onStatus({ id: this.id, connected: false, error: err.message });
    });
    this._child.on('exit', (code, signal) => {
      if (this._stopped) return;
      this.onStatus({
        id: this.id,
        connected: false,
        error: `pinctrl poll exited (${signal || code || 'unknown'})`,
      });
    });
    this._rl = createInterface({ input: this._child.stdout });
    this._rl.on('line', (line) => this._onPinctrlLine(line));
    createInterface({ input: this._child.stderr }).on('line', (line) => {
      if (line && !this._stopped) console.warn('[encoder]', line);
    });
  }

  _onPinctrlLine(line) {
    const s = String(line).trim();
    // Older pinctrl: "17: lo -> hi"
    const arrow = s.match(/^(\d+)\s*:\s*(hi|lo)\s*->\s*(hi|lo)/i);
    if (arrow) {
      this._onLevel(Number(arrow[1]), arrow[3].toLowerCase() === 'hi' ? 1 : 0);
      return;
    }
    // Current Raspberry Pi OS: "17: hi // GPIO17" and "+123us" timestamps
    const level = s.match(/^(\d+)\s*:\s*(hi|lo)\b/i);
    if (!level) return;
    this._onLevel(Number(level[1]), level[2].toLowerCase() === 'hi' ? 1 : 0);
  }

  async _startOnoff() {
    const mod = onoffModule();
    if (!mod?.Gpio) throw new Error('onoff is not installed');
    const { Gpio } = mod;
    if (!Gpio.accessible) throw new Error('GPIO is not accessible');
    const { clk, dt, sw } = this.pins;
    const watch = (pin) => {
      const gpio = new Gpio(pin, 'in', 'both', { debounceTimeout: 0 });
      gpio.watch((err, value) => {
        if (!err) this._onLevel(pin, value);
      });
      return gpio;
    };
    this._gpios = [watch(clk), watch(dt), watch(sw)];
    this.clk = this._gpios[0].readSync();
    this.dt = this._gpios[1].readSync();
    this.sw = this._gpios[2].readSync();
    this.prev = ((this.clk & 1) << 1) | (this.dt & 1);
  }

  _onLevel(pin, value) {
    const v = value ? 1 : 0;
    const { clk, dt, sw, invert } = this.pins;
    if (pin === clk) this.clk = v;
    else if (pin === dt) this.dt = v;
    else if (pin === sw) {
      this._onSwitch(v);
      return;
    } else return;

    const curr = ((this.clk & 1) << 1) | (this.dt & 1);
    if (curr === this.prev) return;
    const delta = ENC_TABLE[((this.prev << 2) | curr) & 0x0f];
    this.prev = curr;
    if (!delta) return;
    this.acc += invert ? -delta : delta;
    if (this.acc >= DETENT) {
      this.acc = 0;
      this.onEvent({ id: this.id, kind: 'cw' });
    } else if (this.acc <= -DETENT) {
      this.acc = 0;
      this.onEvent({ id: this.id, kind: 'ccw' });
    }
  }

  _onSwitch(value) {
    const now = Date.now();
    if (now < this._swIgnoreUntil) return;
    const pressed = value === 0;
    if (pressed === this._swHeld) return;
    this._swHeld = pressed;
    this._swIgnoreUntil = now + SW_DEBOUNCE_MS;
    this.onEvent({ id: this.id, kind: pressed ? 'sw' : 'sw-up' });
  }

  stop() {
    this._stopped = true;
    try {
      this._rl?.close();
    } catch {
      /* ignore */
    }
    this._rl = null;
    if (this._child) {
      try {
        this._child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this._child = null;
    }
    for (const gpio of this._gpios) {
      try {
        gpio.unexport();
      } catch {
        try {
          gpio.unwatchAll();
        } catch {
          /* ignore */
        }
      }
    }
    this._gpios = [];
  }
}

export class EncoderHub {
  constructor({ onEvent, onStatus } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.readers = new Map();
  }

  async start(id, opts) {
    const key = String(id || '');
    if (!key) throw new Error('encoder id required');
    this.stop(key);
    const pins = parsePins(opts);
    for (const [otherId, reader] of this.readers) {
      const p = reader.pins;
      const used = new Set([p.clk, p.dt, p.sw]);
      if (used.has(pins.clk) || used.has(pins.dt) || used.has(pins.sw)) {
        throw new Error(`GPIO pin already used by encoder ${otherId}`);
      }
    }
    const reader = new EncoderWatcher(key, pins, {
      onEvent: this.onEvent,
      onStatus: this.onStatus,
    });
    this.readers.set(key, reader);
    try {
      await reader.start();
    } catch (err) {
      reader.stop();
      this.readers.delete(key);
      throw err;
    }
  }

  stop(id) {
    const key = String(id || '');
    const reader = this.readers.get(key);
    if (!reader) return;
    reader.stop();
    this.readers.delete(key);
    this.onStatus({ id: key, connected: false });
  }

  stopAll() {
    for (const id of [...this.readers.keys()]) this.stop(id);
  }
}
