/**
 * MacBook built-in sensors via Chrome WebHID (+ Generic Sensor / DeviceMotion if present).
 *
 * The Instagram-style hinge trick is the lid-angle HID sensor on many 2019+
 * MacBooks (Apple VID 0x05AC, PID 0x8104, Sensor page / Orientation).
 * Chrome can read it with receiveFeatureReport — same path as DualSense.
 *
 * Internal accelerometer / gyro live on AppleSPU and usually need native
 * IOKit + root; they are still attempted if WebHID lists them.
 */

export const APPLE_VID = 0x05ac;
export const LID_PID = 0x8104;
export const USAGE_PAGE_SENSOR = 0x0020;
export const USAGE_PAGE_VENDOR = 0xff00;
export const USAGE_ORIENTATION = 0x008a;
export const USAGE_ACCEL_3D = 0x0073;
export const USAGE_GYRO_3D = 0x0076;
export const USAGE_AMBIENT_LIGHT = 0x0041;
export const SPU_USAGE_ACCEL = 3;
export const SPU_USAGE_GYRO = 9;

export function macbookHidFilters() {
  return [
    { vendorId: APPLE_VID, productId: LID_PID },
    { vendorId: APPLE_VID, usagePage: USAGE_PAGE_SENSOR, usage: USAGE_ORIENTATION },
    { vendorId: APPLE_VID, usagePage: USAGE_PAGE_SENSOR, usage: USAGE_ACCEL_3D },
    { vendorId: APPLE_VID, usagePage: USAGE_PAGE_SENSOR, usage: USAGE_GYRO_3D },
    { vendorId: APPLE_VID, usagePage: USAGE_PAGE_SENSOR, usage: USAGE_AMBIENT_LIGHT },
    { vendorId: APPLE_VID, usagePage: USAGE_PAGE_VENDOR, usage: SPU_USAGE_ACCEL },
    { vendorId: APPLE_VID, usagePage: USAGE_PAGE_VENDOR, usage: SPU_USAGE_GYRO },
    { usagePage: USAGE_PAGE_SENSOR, usage: USAGE_ORIENTATION },
  ];
}

export function classifyHidDevice(device) {
  const kinds = new Set();
  if (device.vendorId === APPLE_VID && device.productId === LID_PID) kinds.add('lid');
  for (const c of device.collections || []) {
    const page = c.usagePage;
    const usage = c.usage;
    if (page === USAGE_PAGE_SENSOR && usage === USAGE_ORIENTATION) kinds.add('lid');
    if (page === USAGE_PAGE_SENSOR && usage === USAGE_ACCEL_3D) kinds.add('accel');
    if (page === USAGE_PAGE_SENSOR && usage === USAGE_GYRO_3D) kinds.add('gyro');
    if (page === USAGE_PAGE_SENSOR && usage === USAGE_AMBIENT_LIGHT) kinds.add('als');
    if (page === USAGE_PAGE_VENDOR && usage === SPU_USAGE_ACCEL) kinds.add('accel');
    if (page === USAGE_PAGE_VENDOR && usage === SPU_USAGE_GYRO) kinds.add('gyro');
  }
  return [...kinds];
}

export function isMacbookHidSensor(device) {
  if (!device || device.vendorId === 0x054c) return false;
  return classifyHidDevice(device).length > 0;
}

export function parseLidAngle(dataView) {
  if (!dataView || dataView.byteLength < 2) return null;
  const n = dataView.byteLength;
  let offset = 0;
  if (n >= 3) {
    const id = dataView.getUint8(0);
    if (id === 0 || id === 1) offset = 1;
  }
  if (offset + 1 >= n) offset = 0;
  let raw = dataView.getUint16(offset, true);
  if (raw > 360 && raw <= 36000) raw /= 100;
  if (!Number.isFinite(raw) || raw > 360) return null;
  return raw;
}

export function parseSpuXyz(dataView) {
  if (!dataView) return null;
  const tryAt = (base) => {
    if (dataView.byteLength < base + 12) return null;
    const x = dataView.getInt32(base, true) / 65536;
    const y = dataView.getInt32(base + 4, true) / 65536;
    const z = dataView.getInt32(base + 8, true) / 65536;
    if (![x, y, z].every(Number.isFinite)) return null;
    if (Math.abs(x) > 64 || Math.abs(y) > 64 || Math.abs(z) > 64) return null;
    return { x, y, z };
  };
  return tryAt(6) || tryAt(7) || tryAt(0);
}

function round(v, digits = 3) {
  const p = 10 ** digits;
  return Math.round(Number(v) * p) / p;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export class MacbookSensorSource {
  constructor({ onSample, onStatus } = {}) {
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.connected = false;
    this.closedDeg = 12;
    this.angleMax = 180;

    this._hid = [];
    this._generic = [];
    this._want = false;
    this._loopOn = false;
    this._reportIds = new WeakMap();
    this._onHidInput = (event) => this._handleHidReport(event.device, event.data, event.reportId);
    this._onHidGone = (event) => this._dropHid(event.device);

    this.state = this._emptyState();
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  setOptions({ closedDeg, angleMax } = {}) {
    if (closedDeg != null) this.closedDeg = Math.max(1, Math.min(40, Number(closedDeg) || 12));
    if (angleMax != null) this.angleMax = Math.max(90, Math.min(360, Number(angleMax) || 180));
  }

  _emptyState() {
    return {
      lidAngle: null,
      lidOpen: null,
      lidNorm: null,
      accel: null,
      gyro: null,
      als: null,
      sources: [],
    };
  }

  async connect() {
    this._want = true;
    const found = [];

    if (MacbookSensorSource.isSupported()) {
      this.onStatus({ connected: false, connecting: true });
      try {
        const picked = await navigator.hid.requestDevice({
          filters: macbookHidFilters(),
        });
        for (const device of picked || []) found.push(device);
      } catch (err) {
        if (err?.name === 'NotFoundError' || err?.name === 'NotAllowedError') {
          // user cancelled picker — still try generic sensors
        } else {
          this.onStatus({ connected: false, error: err.message });
          throw err;
        }
      }
    }

    if (!found.length && MacbookSensorSource.isSupported()) {
      const granted = await navigator.hid.getDevices();
      for (const device of granted) {
        if (isMacbookHidSensor(device)) found.push(device);
      }
    }

    for (const device of found) {
      await this._openHid(device);
    }

    await this._startGenericSensors();

    const ok = this._hid.length > 0 || this._generic.length > 0;
    this.connected = ok;
    this._want = ok;
    if (!ok) this._stopGenericSensors();
    this.onStatus({
      connected: ok,
      connecting: false,
      sources: this._sourceNames(),
      error: ok
        ? ''
        : 'No sensor found. In the Chrome picker choose the Apple lid / orientation sensor (VID 05AC, PID 8104). Not every MacBook has it.',
    });
    if (ok) {
      this._emit();
      this._startPollLoop();
    }
    return ok;
  }

  async attachGranted(devices) {
    if (this.connected) return false;
    let opened = false;
    for (const device of devices || []) {
      if (!isMacbookHidSensor(device)) continue;
      await this._openHid(device);
      opened = true;
    }
    if (!opened) return false;
    this._want = true;
    this.connected = true;
    this.onStatus({ connected: true, connecting: false, sources: this._sourceNames() });
    this._emit();
    this._startPollLoop();
    return true;
  }

  async disconnect() {
    this._want = false;
    this.connected = false;
    for (const device of [...this._hid]) {
      await this._closeHid(device);
    }
    this._hid = [];
    this._stopGenericSensors();
    this.state = this._emptyState();
    this.onStatus({ connected: false, sources: [] });
  }

  handleHidDisconnect(device) {
    this._dropHid(device);
  }

  /** Watchdog: restart the tight HID loop if it stopped. */
  poll() {
    if (this.connected && this._hid.length) this._startPollLoop();
  }

  _startPollLoop() {
    if (this._loopOn || !this._hid.length) return;
    this._loopOn = true;
    this._runPollLoop();
  }

  async _runPollLoop() {
    try {
      while (this._want && this._hid.length) {
        const t0 = performance.now();
        try {
          await Promise.all(this._hid.map((device) => this._pollDevice(device)));
        } catch {
          // keep reading
        }
        if (performance.now() - t0 < 4 && document.visibilityState === 'visible') {
          await new Promise((r) => requestAnimationFrame(r));
        }
      }
    } finally {
      this._loopOn = false;
    }
  }

  async _openHid(device) {
    if (this._hid.includes(device)) return;
    try {
      if (!device.opened) await device.open();
    } catch (err) {
      console.warn('MacBook HID open failed', device.productName, err);
      return;
    }
    device.addEventListener('inputreport', this._onHidInput);
    device.addEventListener('disconnect', this._onHidGone);
    this._hid.push(device);
    await this._pollDevice(device);
    this._startPollLoop();
  }

  async _closeHid(device) {
    device.removeEventListener('inputreport', this._onHidInput);
    device.removeEventListener('disconnect', this._onHidGone);
    try {
      if (device.opened) await device.close();
    } catch {
      // already gone
    }
  }

  async _dropHid(device) {
    const i = this._hid.indexOf(device);
    if (i < 0) return;
    this._hid.splice(i, 1);
    await this._closeHid(device);
    if (!this._hid.length && !this._generic.length) {
      this.connected = false;
      this.state = this._emptyState();
      this.onStatus({ connected: false, sources: [] });
    } else {
      this.onStatus({ connected: true, sources: this._sourceNames() });
    }
  }

  async _pollDevice(device) {
    const cached = this._reportIds.get(device);
    if (cached != null) {
      try {
        const report = await device.receiveFeatureReport(cached);
        if (report) {
          this._handleHidReport(device, report, cached);
          return;
        }
      } catch {
        this._reportIds.delete(device);
      }
    }

    const ids = new Set([1, 0]);
    for (const c of device.collections || []) {
      for (const r of c.featureReports || []) {
        if (r.reportId != null) ids.add(r.reportId);
      }
    }
    for (const id of ids) {
      if (id === cached) continue;
      try {
        const report = await device.receiveFeatureReport(id);
        if (!report) continue;
        this._reportIds.set(device, id);
        this._handleHidReport(device, report, id);
        return;
      } catch {
        // try next report id
      }
    }
  }

  _handleHidReport(device, dataView, reportId) {
    if (!dataView) return;
    const kinds = classifyHidDevice(device);
    let changed = false;

    if (kinds.includes('lid') || kinds.length === 0) {
      const angle = parseLidAngle(dataView);
      if (angle != null) {
        const nextAngle = round(angle, 3);
        const nextOpen = angle >= this.closedDeg ? 1 : 0;
        const nextNorm = round(clamp01(angle / this.angleMax), 4);
        if (
          nextAngle !== this.state.lidAngle ||
          nextOpen !== this.state.lidOpen ||
          nextNorm !== this.state.lidNorm
        ) {
          this.state.lidAngle = nextAngle;
          this.state.lidOpen = nextOpen;
          this.state.lidNorm = nextNorm;
          changed = true;
        }
      }
    }

    if (kinds.includes('accel') || kinds.includes('gyro')) {
      const xyz = parseSpuXyz(dataView);
      if (xyz) {
        const q = { x: round(xyz.x, 4), y: round(xyz.y, 4), z: round(xyz.z, 4) };
        if (kinds.includes('gyro') && !kinds.includes('accel')) this.state.gyro = q;
        else if (kinds.includes('accel')) this.state.accel = q;
        else if (Math.hypot(xyz.x, xyz.y, xyz.z) > 8) this.state.gyro = q;
        else this.state.accel = q;
        changed = true;
      }
    }

    if (kinds.includes('als') && dataView.byteLength >= 2) {
      const lux = dataView.getUint16(dataView.getUint8(0) <= 1 && dataView.byteLength > 2 ? 1 : 0, true);
      if (Number.isFinite(lux)) {
        this.state.als = lux;
        changed = true;
      }
    }

    if (!changed) {
      const xyz = parseSpuXyz(dataView);
      if (xyz && Math.hypot(xyz.x, xyz.y, xyz.z) > 0.02) {
        this.state.accel = { x: round(xyz.x, 4), y: round(xyz.y, 4), z: round(xyz.z, 4) };
        changed = true;
      }
    }

    if (changed) this._emit();
    void reportId;
  }

  async _startGenericSensors() {
    this._stopGenericSensors();

    const trySensor = (Ctor, freq, apply) => {
      if (typeof Ctor !== 'function') return;
      try {
        const sensor = new Ctor({ frequency: freq });
        sensor.addEventListener('reading', () => apply(sensor));
        sensor.addEventListener('error', () => {
          try {
            sensor.stop();
          } catch {
            // ignore
          }
        });
        sensor.start();
        this._generic.push(sensor);
      } catch {
        // not allowed / not present
      }
    };

    trySensor(window.Accelerometer, 30, (s) => {
      this.state.accel = { x: round(s.x, 4), y: round(s.y, 4), z: round(s.z, 4) };
      this._markConnected('Accelerometer');
      this._emit();
    });
    trySensor(window.Gyroscope, 30, (s) => {
      this.state.gyro = { x: round(s.x, 4), y: round(s.y, 4), z: round(s.z, 4) };
      this._markConnected('Gyroscope');
      this._emit();
    });
    trySensor(window.AmbientLightSensor, 5, (s) => {
      this.state.als = round(s.illuminance, 1);
      this._markConnected('Ambient light');
      this._emit();
    });

    this._onMotion = null;

    if (typeof DeviceMotionEvent !== 'undefined' && !this.state.accel) {
      const onMotion = (e) => {
        const a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;
        const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
        if (mag < 0.5) return;
        this.state.accel = {
          x: round(a.x || 0, 4),
          y: round(a.y || 0, 4),
          z: round(a.z || 0, 4),
        };
        const g = e.rotationRate;
        if (g && Math.hypot(g.alpha || 0, g.beta || 0, g.gamma || 0) > 0.05) {
          this.state.gyro = {
            x: round(g.beta || 0, 4),
            y: round(g.gamma || 0, 4),
            z: round(g.alpha || 0, 4),
          };
        }
        this._markConnected('DeviceMotion');
        this._emit();
      };
      this._onMotion = onMotion;
      window.addEventListener('devicemotion', onMotion);
    }
  }

  _stopGenericSensors() {
    for (const sensor of this._generic) {
      try {
        sensor.stop?.();
      } catch {
        // ignore
      }
    }
    this._generic = [];
    if (this._onMotion) {
      window.removeEventListener('devicemotion', this._onMotion);
      this._onMotion = null;
    }
  }

  _markConnected(name) {
    if (this.connected) return;
    this.connected = true;
    this._want = true;
    this.onStatus({ connected: true, sources: [...this._sourceNames(), name] });
  }

  _sourceNames() {
    const names = this._hid.map((d) => {
      const kinds = classifyHidDevice(d);
      const kind = kinds[0] || 'hid';
      return d.productName || kind;
    });
    if (this.state.accel && !names.some((n) => /accel|motion/i.test(n))) names.push('Accelerometer');
    if (this.state.gyro && !names.some((n) => /gyro/i.test(n))) names.push('Gyroscope');
    if (this.state.als != null && !names.some((n) => /light|als/i.test(n))) names.push('Ambient light');
    return names;
  }

  _emit() {
    this.state.sources = this._sourceNames();
    this.onSample({ ...this.state, t: performance.now() });
  }
}
