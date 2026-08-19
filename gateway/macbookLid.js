/**
 * Native MacBook lid-angle reader (hidapi / node-hid).
 *
 * Chrome WebHID receiveFeatureReport on this sensor is effectively ~1 Hz.
 * IOKit via hidapi can poll it at display rate, which is what the viral
 * lid-angle demos actually use.
 */

const APPLE_VID = 0x05ac;
const LID_PID = 0x8104;
const USAGE_PAGE_SENSOR = 0x0020;
const USAGE_ORIENTATION = 0x008a;

let HID = null;
let hidLoad = null;

async function loadHid() {
  if (HID) return HID;
  if (hidLoad) return hidLoad;
  hidLoad = import('node-hid')
    .then((mod) => {
      HID = mod.default || mod;
      return HID;
    })
    .catch((err) => {
      hidLoad = null;
      throw err;
    });
  return hidLoad;
}

export function parseLidBytes(bytes) {
  if (!bytes || bytes.length < 2) return null;
  let i = 0;
  if (bytes.length >= 3 && (bytes[0] === 0 || bytes[0] === 1)) i = 1;
  if (i + 1 >= bytes.length) i = 0;
  let raw = bytes[i] | (bytes[i + 1] << 8);
  if (raw > 360 && raw <= 36000) raw /= 100;
  if (!Number.isFinite(raw) || raw > 360) return null;
  return raw;
}

export function findLidDeviceInfo(HIDLib = HID) {
  if (!HIDLib?.devices) return null;
  const list = HIDLib.devices();
  return (
    list.find(
      (d) =>
        d.vendorId === APPLE_VID &&
        d.usagePage === USAGE_PAGE_SENSOR &&
        d.usage === USAGE_ORIENTATION,
    ) ||
    list.find((d) => d.vendorId === APPLE_VID && d.productId === LID_PID) ||
    null
  );
}

export async function probeLidSensor() {
  try {
    const lib = await loadHid();
    const info = findLidDeviceInfo(lib);
    return {
      native: true,
      available: !!info,
      name: info?.product || info?.productName || 'Lid angle',
    };
  } catch (err) {
    return { native: false, available: false, error: err.message };
  }
}

export class MacbookLidPoller {
  constructor({ onSample, onStatus } = {}) {
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.closedDeg = 12;
    this.angleMax = 180;
    this.running = false;
    this._device = null;
    this._reportId = 1;
    this._reportLen = 8;
    this._lastAngle = null;
  }

  setOptions({ closedDeg, angleMax } = {}) {
    if (closedDeg != null) this.closedDeg = Math.max(1, Math.min(40, Number(closedDeg) || 12));
    if (angleMax != null) this.angleMax = Math.max(90, Math.min(360, Number(angleMax) || 180));
  }

  async start() {
    if (this.running) return true;
    const lib = await loadHid();
    const info = findLidDeviceInfo(lib);
    if (!info?.path) {
      this.onStatus({ connected: false, error: 'Lid angle sensor not found on this Mac.' });
      return false;
    }

    try {
      this._device = new lib.HID(info.path);
    } catch (err) {
      this.onStatus({
        connected: false,
        error: `Could not open lid sensor (${err.message}). Close other lid-angle apps / the Chrome HID picker and retry.`,
      });
      return false;
    }

    this._probeReport();
    this.running = true;
    this.onStatus({
      connected: true,
      native: true,
      sources: [info.product || 'Lid angle'],
    });
    this._tick();
    return true;
  }

  stop() {
    this.running = false;
    if (this._device) {
      try {
        this._device.close();
      } catch {
        // ignore
      }
      this._device = null;
    }
    this._lastAngle = null;
    this.onStatus({ connected: false, native: true, sources: [] });
  }

  _probeReport() {
    if (!this._device) return;
    for (const id of [1, 0]) {
      for (const len of [3, 8, 16]) {
        try {
          const data = this._device.getFeatureReport(id, len);
          if (parseLidBytes(data) != null) {
            this._reportId = id;
            this._reportLen = len;
            return;
          }
        } catch {
          // try next
        }
      }
    }
  }

  _readAngle() {
    if (!this._device) return null;
    try {
      const data = this._device.getFeatureReport(this._reportId, this._reportLen);
      return parseLidBytes(data);
    } catch {
      return null;
    }
  }

  _tick() {
    if (!this.running) return;
    const angle = this._readAngle();
    if (angle != null) {
      const lidAngle = Math.round(angle * 1000) / 1000;
      if (lidAngle !== this._lastAngle) {
        this._lastAngle = lidAngle;
        const lidOpen = angle >= this.closedDeg ? 1 : 0;
        const lidNorm = Math.min(1, Math.max(0, angle / this.angleMax));
        this.onSample({
          lidAngle,
          lidOpen,
          lidNorm: Math.round(lidNorm * 10000) / 10000,
          sources: ['Lid angle'],
        });
      }
    }
    setImmediate(() => this._tick());
  }
}
