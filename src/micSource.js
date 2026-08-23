/**
 * Browser microphone → RMS / peak volume in [0, 1].
 */

export const MIC_PREFIX = '/mic';

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export class MicSource {
  constructor({ onSample, onStatus } = {}) {
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.connected = false;
    this.deviceId = '';
    this.deviceLabel = '';
    this.sensitivity = 6;
    this.smoothing = 0.65;
    this.level = 0;
    this.peak = 0;

    this._ctx = null;
    this._stream = null;
    this._source = null;
    this._analyser = null;
    this._buf = null;
    this._raf = 0;
    this._peakHold = 0;
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  setOptions({ sensitivity, smoothing } = {}) {
    if (sensitivity != null) this.sensitivity = Math.max(0.2, Number(sensitivity) || 6);
    if (smoothing != null) this.smoothing = clamp01(Number(smoothing));
  }

  async listDevices() {
    if (!MicSource.isSupported()) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        id: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      }));
  }

  async connect(deviceId = '') {
    if (!MicSource.isSupported()) throw new Error('Microphone is not available in this browser');
    await this.disconnect();

    const constraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    };

    this.onStatus({ connecting: true, connected: false });
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = stream.getAudioTracks()[0];
    this._stream = stream;
    this.deviceId = track?.getSettings?.().deviceId || deviceId || '';
    this.deviceLabel = track?.label || 'Microphone';

    const ctx = new AudioContext();
    this._ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this._source = ctx.createMediaStreamSource(stream);
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._analyser.smoothingTimeConstant = 0;
    this._source.connect(this._analyser);
    this._buf = new Float32Array(this._analyser.fftSize);
    this.connected = true;
    this.level = 0;
    this.peak = 0;
    this._peakHold = 0;
    this.onStatus({ connected: true, connecting: false, name: this.deviceLabel, deviceId: this.deviceId });
    this._tick();
    return { deviceId: this.deviceId, label: this.deviceLabel };
  }

  async disconnect() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    try {
      this._source?.disconnect();
    } catch {
      // ignore
    }
    this._analyser = null;
    this._source = null;
    this._buf = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    if (this._ctx) {
      try {
        await this._ctx.close();
      } catch {
        // ignore
      }
    }
    this._ctx = null;
    const was = this.connected;
    this.connected = false;
    this.level = 0;
    this.peak = 0;
    if (was) this.onStatus({ connected: false, connecting: false });
  }

  _tick = () => {
    if (!this.connected || !this._analyser) return;
    this._analyser.getFloatTimeDomainData(this._buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this._buf.length; i++) {
      const v = this._buf[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / this._buf.length);
    const inst = clamp01(rms * this.sensitivity);
    const instPeak = clamp01(peak * this.sensitivity);
    this.level += (inst - this.level) * (1 - this.smoothing);
    this._peakHold = Math.max(instPeak, this._peakHold * 0.94);
    this.peak = this._peakHold;
    this.onSample({ level: this.level, peak: this.peak, name: this.deviceLabel });
    this._raf = requestAnimationFrame(this._tick);
  };
}
