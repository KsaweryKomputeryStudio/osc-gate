/**
 * Webcam + YOLOv8n person counter.
 */

import { detectPersons, loadYolo } from './yoloDetect.js';
import { scale01 } from './oscInScale.js';

export const HUMAN_PREFIX = '/human';

export function countToOsc(count, { countMode = 'off', countMin = 0, countMax = 8 } = {}, observed = null) {
  const n = Number(count);
  const raw = Number.isFinite(n) ? n : 0;
  if (countMode === 'auto') return round3(scale01(raw, observed?.min, observed?.max));
  if (countMode === 'manual') return round3(scale01(raw, countMin, countMax));
  return raw;
}

function round3(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

export class HumanCountSource {
  constructor({ video, overlay, onSample, onStatus } = {}) {
    this.video = video;
    this.overlay = overlay;
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.connected = false;
    this.deviceId = '';
    this.deviceLabel = '';
    this.confidence = 0.35;
    this.iou = 0.45;
    this.count = 0;
    this.boxes = [];

    this._stream = null;
    this._session = null;
    this._inferCanvas = document.createElement('canvas');
    this._loop = false;
    this._busy = false;
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  setOptions({ confidence, iou } = {}) {
    if (confidence != null) this.confidence = Math.min(0.9, Math.max(0.1, Number(confidence) || 0.35));
    if (iou != null) this.iou = Math.min(0.9, Math.max(0.1, Number(iou) || 0.45));
  }

  async listDevices() {
    if (!HumanCountSource.isSupported()) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({
        id: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
  }

  async connect(deviceId = '') {
    if (!HumanCountSource.isSupported()) throw new Error('Camera is not available in this browser');
    await this.disconnect();
    this.onStatus({ connecting: true, connected: false, message: 'Starting camera…' });

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this._stream = stream;
    const track = stream.getVideoTracks()[0];
    this.deviceId = track?.getSettings?.().deviceId || deviceId || '';
    this.deviceLabel = track?.label || 'Camera';

    this.onStatus({ connecting: true, connected: false, preview: true, name: this.deviceLabel, message: 'Starting camera…' });
    await this._attachStream(stream);
    this.onStatus({ connecting: true, connected: false, preview: true, name: this.deviceLabel, message: 'Loading YOLOv8n…' });
    this._session = await loadYolo({
      onProgress: (message) => this.onStatus({ connecting: true, connected: false, message }),
    });

    this.connected = true;
    this._loop = true;
    this.onStatus({ connected: true, connecting: false, name: this.deviceLabel, deviceId: this.deviceId });
    this._tick();
    return { deviceId: this.deviceId, label: this.deviceLabel };
  }

  async disconnect() {
    this._loop = false;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    if (this.video) this.video.srcObject = null;
    this._clearOverlay();
    const was = this.connected;
    this.connected = false;
    this.count = 0;
    this.boxes = [];
    if (was) this.onStatus({ connected: false, connecting: false });
  }

  async _attachStream(stream) {
    if (!this.video) return;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
  }

  _clearOverlay() {
    const c = this.overlay;
    if (!c) return;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  _drawBoxes() {
    const video = this.video;
    const canvas = this.overlay;
    if (!video || !canvas || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const line = Math.max(2, Math.round(w / 400));
    ctx.strokeStyle = 'rgb(255, 140, 0)';
    ctx.lineWidth = line;
    ctx.font = `${Math.max(12, Math.round(w / 48))}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    for (const b of this.boxes) {
      const x = b.x1;
      const y = b.y1;
      const bw = Math.max(1, b.x2 - b.x1);
      const bh = Math.max(1, b.y2 - b.y1);
      ctx.strokeRect(x, y, bw, bh);
      const label = `person ${b.score.toFixed(2)}`;
      const tw = ctx.measureText(label).width + 8;
      const th = 16;
      ctx.fillStyle = 'rgb(255, 140, 0)';
      ctx.fillRect(x, Math.max(0, y - th), tw, th);
      ctx.fillStyle = '#000';
      ctx.fillText(label, x + 4, Math.max(0, y - th) + 2);
    }
  }

  _tick = async () => {
    if (!this._loop || !this.connected) return;
    if (this._busy || !this.video?.videoWidth) {
      requestAnimationFrame(this._tick);
      return;
    }
    this._busy = true;
    try {
      this.boxes = await detectPersons(this._session, this.video, this._inferCanvas, {
        confidence: this.confidence,
        iou: this.iou,
      });
      this.count = this.boxes.length;
      this._drawBoxes();
      this.onSample({
        count: this.count,
        present: this.count > 0 ? 1 : 0,
        boxes: this.boxes,
        name: this.deviceLabel,
      });
    } catch (err) {
      this.onStatus({ connected: true, error: err.message });
    } finally {
      this._busy = false;
      if (this._loop) requestAnimationFrame(this._tick);
    }
  };
}
