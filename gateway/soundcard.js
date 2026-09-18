/**
 * Multi-channel sound-card capture in the Node gateway (RtAudio / CoreAudio).
 * Browser getUserMedia is stereo-only on many machines; this path is not.
 */

import audify from 'audify';

const { RtAudio, RtAudioFormat } = audify;

const MAX_CHANNELS = 16;
const FRAME_SIZE = 512;
const SEND_HZ = 30;

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function round3(v) {
  return Math.round(clamp01(v) * 1000) / 1000;
}

export function probeSoundcard() {
  try {
    const rt = new RtAudio();
    const devices = listFromRt(rt);
    return {
      native: true,
      available: devices.length > 0,
      devices,
      defaultId: String(rt.getDefaultInputDevice?.() ?? devices[0]?.id ?? ''),
    };
  } catch (err) {
    return { native: false, available: false, devices: [], error: err.message };
  }
}

function listFromRt(rt) {
  const devices = rt.getDevices?.() || [];
  return devices
    .filter((d) => Number(d.inputChannels) > 0)
    .map((d) => ({
      id: String(d.id),
      name: String(d.name || `Input ${d.id}`),
      channels: Math.min(MAX_CHANNELS, Number(d.inputChannels) || 1),
      defaultInput: !!d.isDefaultInput,
      sampleRate: Number(d.preferredSampleRate) || 48000,
    }));
}

export class SoundcardCapture {
  constructor({ onSample, onStatus } = {}) {
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.connected = false;
    this.deviceId = '';
    this.deviceName = '';
    this.channels = 2;
    this.sensitivity = 6;
    this.smoothing = 0.65;

    this._rt = null;
    this._timer = null;
    this._sumSq = [];
    this._peakRaw = [];
    this._frames = 0;
    this._level = [];
    this._peakHold = [];
  }

  listDevices() {
    this._ensureRt();
    return listFromRt(this._rt);
  }

  setOptions({ sensitivity, smoothing } = {}) {
    if (sensitivity != null) this.sensitivity = Math.max(0.2, Number(sensitivity) || 6);
    if (smoothing != null) this.smoothing = clamp01(Number(smoothing));
  }

  async start({ deviceId = '', channels = 8 } = {}) {
    this._ensureRt();
    const devices = listFromRt(this._rt);
    const want = String(deviceId || '');
    const dev =
      devices.find((d) => d.id === want) ||
      devices.find((d) => d.defaultInput) ||
      devices[0];
    if (!dev) throw new Error('No sound-card input found');

    const n = Math.max(1, Math.min(MAX_CHANNELS, Math.min(Number(channels) || 8, dev.channels)));
    if (this.connected && this.deviceId === dev.id && this.channels === n) return;
    this.stop();
    const rate = dev.sampleRate || 48000;
    this._resetMeters(n);
    this.deviceId = dev.id;
    this.deviceName = dev.name;
    this.channels = n;

    this.onStatus({
      connected: false,
      connecting: true,
      name: dev.name,
      channels: n,
      deviceId: dev.id,
    });

    try {
      this._rt.openStream(
        null,
        { deviceId: Number(dev.id), nChannels: n, firstChannel: 0 },
        RtAudioFormat.RTAUDIO_SINT16,
        rate,
        FRAME_SIZE,
        'data-driver-soundcard',
        (pcm) => this._onPcm(pcm, n),
        null,
      );
      this._rt.start();
    } catch (err) {
      this._safeClose();
      throw new Error(err.message || 'Could not open sound-card input');
    }

    this.connected = true;
    this.onStatus({
      connected: true,
      connecting: false,
      name: this.deviceName,
      channels: n,
      deviceId: this.deviceId,
    });
    this._timer = setInterval(() => this._flush(), 1000 / SEND_HZ);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    const was = this.connected;
    this.connected = false;
    this._safeClose();
    if (was) this.onStatus({ connected: false, connecting: false, name: this.deviceName });
  }

  _ensureRt() {
    if (this._rt) return;
    this._rt = new RtAudio();
  }

  _resetMeters(n) {
    this._sumSq = Array(n).fill(0);
    this._peakRaw = Array(n).fill(0);
    this._frames = 0;
    this._level = Array(n).fill(0);
    this._peakHold = Array(n).fill(0);
  }

  _onPcm(pcm, n) {
    const samples = pcm.length / 2;
    const frames = Math.floor(samples / n);
    if (frames < 1) return;
    for (let f = 0; f < frames; f++) {
      const base = f * n;
      for (let c = 0; c < n; c++) {
        const v = pcm.readInt16LE((base + c) * 2) / 32768;
        this._sumSq[c] += v * v;
        const a = Math.abs(v);
        if (a > this._peakRaw[c]) this._peakRaw[c] = a;
      }
    }
    this._frames += frames;
  }

  _flush() {
    if (!this.connected || this._frames < 1) return;
    const n = this.channels;
    const levels = [];
    const peaks = [];
    const a = 1 - this.smoothing;
    for (let c = 0; c < n; c++) {
      const rms = Math.sqrt(this._sumSq[c] / this._frames);
      const inst = clamp01(rms * this.sensitivity);
      const instPeak = clamp01(this._peakRaw[c] * this.sensitivity);
      this._level[c] += (inst - this._level[c]) * a;
      this._peakHold[c] = Math.max(instPeak, this._peakHold[c] * 0.94);
      levels.push(round3(this._level[c]));
      peaks.push(round3(this._peakHold[c]));
      this._sumSq[c] = 0;
      this._peakRaw[c] = 0;
    }
    this._frames = 0;
    this.onSample({
      levels,
      peaks,
      channels: n,
      name: this.deviceName,
      deviceId: this.deviceId,
    });
  }

  _safeClose() {
    if (!this._rt) return;
    try {
      if (this._rt.isStreamRunning?.()) this._rt.stop();
    } catch {
      // ignore
    }
    try {
      if (this._rt.isStreamOpen?.()) this._rt.closeStream();
    } catch {
      // ignore
    }
  }
}

export { MAX_CHANNELS as SOUNDCARD_MAX_CHANNELS };
