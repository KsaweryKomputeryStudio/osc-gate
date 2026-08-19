/**
 * Garmin (and any BLE Heart Rate Profile) collector via Web Bluetooth.
 *
 * Garmin Broadcast Heart Rate uses the standard GATT Heart Rate Service
 * (0x180D). Enable it on the watch: Sensors → Heart Rate → Broadcast.
 * Disconnect Garmin Connect / the phone first — watches usually allow
 * only one BLE central at a time.
 */

export const HEART_RATE_SERVICE = 0x180d;
export const HEART_RATE_MEASUREMENT = 0x2a37;

export function parseHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  const hr16 = !!(flags & 0x01);
  let offset = 1;
  const hr = hr16 ? dataView.getUint16(offset, true) : dataView.getUint8(offset);
  offset += hr16 ? 2 : 1;

  if (flags & 0x08) offset += 2; // energy expended

  const rr = [];
  if (flags & 0x10) {
    while (offset + 1 < dataView.byteLength) {
      rr.push(dataView.getUint16(offset, true) / 1024);
      offset += 2;
    }
  }

  return { hr, rr, contact: (flags >> 1) & 0x03 };
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function hrToOsc(hr, { normalizeHr, hrMin, hrMax }) {
  if (!Number.isFinite(hr)) return 0;
  if (!normalizeHr) return hr;
  const min = Number(hrMin) || 40;
  const max = Number(hrMax) || 200;
  const span = Math.max(1, max - min);
  return Math.round(clamp01((hr - min) / span) * 1000) / 1000;
}

/** Map bpm delta over the window → 0..1 (0.5 = no change). */
export function trendToOsc(deltaBpm, rangeBpm, { quantize = 3 } = {}) {
  const range = Math.max(1, Number(rangeBpm) || 20);
  const v = clamp01(deltaBpm / (2 * range) + 0.5);
  if (quantize == null) return v;
  const p = 10 ** quantize;
  return Math.round(v * p) / p;
}

export class GarminHrSource {
  constructor({ onSample, onBeat, onStatus } = {}) {
    this.onSample = onSample || (() => {});
    this.onBeat = onBeat || (() => {});
    this.onStatus = onStatus || (() => {});

    this.device = null;
    this.lastDeviceId = '';
    this._server = null;
    this._characteristic = null;
    this.connected = false;

    this.hr = null;
    this.samples = [];
    this.trendWindowSec = 30;
    this.trendSmooth = false;
    this.trendSmoothSec = 2;
    this._smoothedTrend = 0.5;
    this._trendStepAt = 0;
    this.sendBeats = true;

    this._wantConnect = false;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._reconnectInFlight = false;
    this._watchingAds = false;

    this._beatTimer = null;
    this._beatRunning = false;
    this._nextBeatAt = 0;
    this._audioClock = null;
    this._onValue = (event) => this._handleValue(event);
    this._onDisconnected = () => this._handleDisconnected();
    this._onAdvert = () => this._onAdvertisement();
    this._onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!this._wantConnect || this.connected) return;
      this._clearReconnect();
      this._tryReconnect();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisible);
    }
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  setAudioClock(clock) {
    this._audioClock = clock;
    if (this._beatTimer) {
      clearTimeout(this._beatTimer);
      this._beatTimer = null;
    }
    if (this._beatRunning && this.hr) this._syncAudioClock();
  }

  _syncAudioClock() {
    this._audioClock?.setMetronome({
      bpm: this.hr,
      enabled: this._beatRunning && this.sendBeats,
    });
  }

  setOptions({ trendWindowSec, sendBeats, trendSmooth, trendSmoothSec } = {}) {
    if (trendWindowSec != null) {
      this.trendWindowSec = Math.max(1, Math.min(600, Number(trendWindowSec) || 30));
    }
    if (trendSmoothSec != null) {
      this.trendSmoothSec = Math.max(0.2, Math.min(30, Number(trendSmoothSec) || 2));
    }
    if (trendSmooth != null) {
      const on = !!trendSmooth;
      if (on && !this.trendSmooth) this._trendStepAt = 0;
      this.trendSmooth = on;
    }
    if (sendBeats != null) {
      this.sendBeats = !!sendBeats;
      if (!this.sendBeats) this._stopBeatClock();
      else this._startBeatClock();
    }
  }

  /** Exponentially approach the current window trend. Returns 0–1. */
  stepTrend(rangeBpm, dtSec) {
    const target = trendToOsc(this.getTrendDelta(), rangeBpm, { quantize: null });
    if (!this.trendSmooth) {
      this._smoothedTrend = target;
      this._trendStepAt = performance.now();
      return trendToOsc(this.getTrendDelta(), rangeBpm);
    }
    const now = performance.now();
    const dt =
      dtSec != null
        ? dtSec
        : this._trendStepAt
          ? (now - this._trendStepAt) / 1000
          : 0;
    if (!this._trendStepAt) {
      this._smoothedTrend = target;
      this._trendStepAt = now;
      return Math.round(clamp01(target) * 10000) / 10000;
    }
    this._trendStepAt = now;
    if (dt > 0) {
      const tau = Math.max(0.05, this.trendSmoothSec);
      const a = 1 - Math.exp(-Math.min(0.25, dt) / tau);
      this._smoothedTrend += (target - this._smoothedTrend) * a;
    }
    return Math.round(clamp01(this._smoothedTrend) * 10000) / 10000;
  }

  getTrendDelta() {
    const now = performance.now();
    const cutoff = now - this.trendWindowSec * 1000;
    this.samples = this.samples.filter((s) => s.t >= cutoff);
    if (this.hr == null || this.samples.length < 2) return 0;
    return this.hr - this.samples[0].hr;
  }

  async connect() {
    if (!GarminHrSource.isSupported()) {
      throw new Error('Web Bluetooth is not available in this browser.');
    }
    this._wantConnect = true;
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['battery_service'],
      });
      await this._attach(device);
      return device;
    } catch (err) {
      if (err?.name === 'NotFoundError' || err?.name === 'NotAllowedError') {
        this._wantConnect = false;
        this._clearReconnect();
        this.onStatus({ connected: false });
      } else {
        this._scheduleReconnect();
      }
      throw err;
    }
  }

  async reconnect(deviceId) {
    this._wantConnect = true;
    this.onStatus({ connected: false, connecting: true, reconnecting: true });
    const device = await this._findPermittedDevice(deviceId || this.lastDeviceId);
    if (!device) {
      this._scheduleReconnect();
      return false;
    }
    try {
      await this._attach(device);
      return true;
    } catch {
      this._scheduleReconnect();
      return false;
    }
  }

  async _findPermittedDevice(deviceId) {
    if (!GarminHrSource.isSupported() || !navigator.bluetooth.getDevices) return null;
    const devices = await navigator.bluetooth.getDevices();
    if (deviceId) {
      const match = devices.find((d) => d.id === deviceId);
      if (match) return match;
    }
    return devices.find((d) => d.gatt) || null;
  }

  async disconnect() {
    this._wantConnect = false;
    this._clearReconnect();
    this._unwatchAdvertisements();
    this._stopBeatClock();
    this._teardownCharacteristic();
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnected);
      try {
        this.device.gatt?.disconnect();
      } catch {
        // already gone
      }
    }
    this.device = null;
    this._server = null;
    this.connected = false;
    this.hr = null;
    this.samples = [];
    this._smoothedTrend = 0.5;
    this._trendStepAt = 0;
    this.onStatus({ connected: false });
  }

  async _attach(device) {
    this._wantConnect = true;
    this._clearReconnect();

    if (this.device && this.device !== device) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnected);
      this._unwatchAdvertisements();
      try {
        this.device.gatt?.disconnect();
      } catch {
        // ignore
      }
    }

    this.device = device;
    this.lastDeviceId = device.id;
    this.device.removeEventListener('gattserverdisconnected', this._onDisconnected);
    this.device.addEventListener('gattserverdisconnected', this._onDisconnected);

    this.onStatus({
      connected: false,
      connecting: true,
      name: device.name || 'Garmin HR',
    });

    this._server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await this._server.getPrimaryService(HEART_RATE_SERVICE);
    this._teardownCharacteristic();
    this._characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    this._characteristic.addEventListener('characteristicvaluechanged', this._onValue);
    await this._characteristic.startNotifications();

    this._unwatchAdvertisements();
    this._reconnectAttempt = 0;
    if (!this._wantConnect) {
      try {
        device.gatt?.disconnect();
      } catch {
        // user cancelled while connecting
      }
      this.connected = false;
      return;
    }
    this.connected = true;
    this.onStatus({
      connected: true,
      connecting: false,
      name: device.name || 'Garmin HR',
      id: device.id,
    });
  }

  _handleDisconnected() {
    this._stopBeatClock();
    this._teardownCharacteristic();
    this._server = null;
    this.connected = false;
    this.hr = null;

    if (!this._wantConnect) {
      this.onStatus({
        connected: false,
        name: this.device?.name || 'Garmin HR',
        id: this.device?.id,
      });
      return;
    }

    this.onStatus({
      connected: false,
      connecting: true,
      reconnecting: true,
      name: this.device?.name || 'Garmin HR',
      id: this.device?.id,
    });
    this._watchAdvertisements();
    this._scheduleReconnect(400);
  }

  _scheduleReconnect(ms) {
    if (!this._wantConnect || this.connected) return;
    this._clearReconnect();
    const delay = ms ?? Math.min(12000, 400 * 2 ** Math.min(this._reconnectAttempt, 5));
    this._reconnectAttempt += 1;
    this._reconnectTimer = setTimeout(() => this._tryReconnect(), delay);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  async _tryReconnect() {
    if (!this._wantConnect || this.connected || this._reconnectInFlight) return;
    this._reconnectInFlight = true;
    try {
      let device = this.device;
      if (!device) device = await this._findPermittedDevice(this.lastDeviceId);
      if (!device) return;
      this.onStatus({
        connected: false,
        connecting: true,
        reconnecting: true,
        name: device.name || 'Garmin HR',
      });
      await this._attach(device);
    } catch {
      // retry below
    } finally {
      this._reconnectInFlight = false;
    }
    if (this._wantConnect && !this.connected) this._scheduleReconnect();
  }

  async _watchAdvertisements() {
    if (this._watchingAds || !this.device?.watchAdvertisements) return;
    try {
      this.device.removeEventListener('advertisementreceived', this._onAdvert);
      this.device.addEventListener('advertisementreceived', this._onAdvert);
      await this.device.watchAdvertisements();
      this._watchingAds = true;
    } catch {
      this._watchingAds = false;
    }
  }

  _unwatchAdvertisements() {
    if (this.device) {
      this.device.removeEventListener('advertisementreceived', this._onAdvert);
      try {
        this.device.unwatchAdvertisements?.();
      } catch {
        // ignore
      }
    }
    this._watchingAds = false;
  }

  _onAdvertisement() {
    if (!this._wantConnect || this.connected || this._reconnectInFlight) return;
    this._reconnectAttempt = 0;
    this._clearReconnect();
    this._tryReconnect();
  }

  _teardownCharacteristic() {
    if (!this._characteristic) return;
    this._characteristic.removeEventListener('characteristicvaluechanged', this._onValue);
    try {
      this._characteristic.stopNotifications();
    } catch {
      // ignore
    }
    this._characteristic = null;
  }

  _handleValue(event) {
    const { hr } = parseHeartRateMeasurement(event.target.value);
    if (!Number.isFinite(hr) || hr <= 0) return;

    const now = performance.now();
    const prevHr = this.hr;
    this.hr = hr;
    this.samples.push({ t: now, hr });
    const cutoff = now - Math.max(this.trendWindowSec, 120) * 1000;
    if (this.samples.length > 2000) {
      this.samples = this.samples.filter((s) => s.t >= cutoff);
    }

    this.onSample({
      hr,
      trendDelta: this.getTrendDelta(),
      name: this.device?.name || 'Garmin HR',
      t: now,
    });

    if (!this.sendBeats) return;
    if (!this._beatRunning) this._startBeatClock();
    else this._rescheduleForHrChange(prevHr, hr);
  }

  _beatIntervalMs() {
    return 60000 / Math.max(20, Math.min(240, this.hr || 60));
  }

  _startBeatClock() {
    if (this._beatRunning) return;
    if (!this.sendBeats || !this.connected || !(this.hr >= 20)) return;
    this._beatRunning = true;
    if (this._audioClock) {
      this._syncAudioClock();
      return;
    }
    this.onBeat(1);
    this._nextBeatAt = performance.now() + this._beatIntervalMs();
    this._armBeatTimeout();
  }

  _rescheduleForHrChange(prevHr, newHr) {
    if (!this._beatRunning || !prevHr || prevHr === newHr) return;
    if (this._audioClock) {
      this._syncAudioClock();
      return;
    }
    const now = performance.now();
    const remaining = this._nextBeatAt - now;
    if (remaining <= 0) return;
    this._nextBeatAt = now + Math.max(8, remaining * (prevHr / newHr));
    this._armBeatTimeout();
  }

  _armBeatTimeout() {
    if (this._audioClock) return;
    if (this._beatTimer) {
      clearTimeout(this._beatTimer);
      this._beatTimer = null;
    }
    if (!this._beatRunning) return;
    const wait = Math.max(8, this._nextBeatAt - performance.now());
    this._beatTimer = setTimeout(() => this._onBeatDue(), wait);
  }

  _onBeatDue() {
    if (!this._beatRunning || !this.sendBeats || !this.connected || !(this.hr >= 20)) return;
    const now = performance.now();
    const interval = this._beatIntervalMs();
    let n = 0;
    while (this._nextBeatAt <= now + 2 && n < 3) {
      this.onBeat();
      this._nextBeatAt += interval;
      n++;
    }
    if (this._nextBeatAt <= now) this._nextBeatAt = now + interval;
    this._armBeatTimeout();
  }

  _stopBeatClock() {
    this._beatRunning = false;
    this._nextBeatAt = 0;
    this._audioClock?.stopMetronome();
    if (this._beatTimer) {
      clearTimeout(this._beatTimer);
      this._beatTimer = null;
    }
  }
}
