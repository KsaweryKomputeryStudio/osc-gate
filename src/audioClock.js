/**
 * Audio-thread metronome + silent keep-alive.
 *
 * Chrome throttles setTimeout/rAF in background tabs (the DualSense path
 * avoids that by emitting from HID inputreport). Garmin HR notifications
 * are sparse (~1 Hz) and beats need a clock, so we schedule on AudioContext
 * which stays active while a graph is connected.
 */

const WORKLET = `
class OscBeatProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.interval = 1;
    this.next = 0;
    this.pulseOff = 0;
    this.tickHz = 0;
    this.nextTick = 0;
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.bpm) {
        const iv = 60 / Math.max(20, Math.min(240, Number(msg.bpm) || 60));
        if (this.enabled && this.next > currentTime && this.interval > 0) {
          const remaining = this.next - currentTime;
          this.next = currentTime + Math.max(0.008, remaining * (iv / this.interval));
        }
        this.interval = iv;
      }
      if (msg.enabled != null) {
        const on = !!msg.enabled;
        if (on && !this.enabled) {
          this.enabled = true;
          this.next = currentTime;
        } else if (!on) {
          this.enabled = false;
          this.pulseOff = 0;
        }
      }
      if (msg.tickHz != null) {
        const hz = Math.max(0, Math.min(60, Number(msg.tickHz) || 0));
        this.tickHz = hz;
        this.nextTick = hz ? currentTime : 0;
      }
    };
  }

  process() {
    const now = currentTime;
    if (this.tickHz > 0 && now >= this.nextTick) {
      this.port.postMessage({ tick: true });
      this.nextTick = now + 1 / this.tickHz;
    }
    if (this.pulseOff && now >= this.pulseOff) {
      this.port.postMessage({ v: 0 });
      this.pulseOff = 0;
    }
    if (!this.enabled) return true;
    let n = 0;
    while (this.next <= now && n < 4) {
      this.port.postMessage({ v: 1 });
      this.pulseOff = now + 0.04;
      this.next += this.interval;
      n++;
    }
    if (this.next < now) this.next = now + this.interval;
    return true;
  }
}
registerProcessor('osc-beat', OscBeatProcessor);
`;

export class AudioClock {
  constructor({ onPulse, onTick } = {}) {
    this.onPulse = onPulse || (() => {});
    this.onTick = onTick || (() => {});
    this.ctx = null;
    this._node = null;
    this._keepAlive = null;
    this._gain = null;
    this._ready = null;
    this._bpm = 60;
    this._enabled = false;
    this._tickHz = 0;
    this._onGesture = () => this.resume();
  }

  async start() {
    if (this._ready) return this._ready;
    this._ready = this._init();
    try {
      await this._ready;
    } catch (err) {
      this._ready = null;
      throw err;
    }
    return this._ready;
  }

  async _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is not available');

    this.ctx = new Ctx();
    const blob = new Blob([WORKLET], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    this._node = new AudioWorkletNode(this.ctx, 'osc-beat');
    this._node.port.onmessage = (e) => {
      if (e.data?.tick) this.onTick();
      const v = e.data?.v;
      if (v === 0 || v === 1) this.onPulse(v);
    };

    this._gain = this.ctx.createGain();
    this._gain.gain.value = 0.00008;
    this._keepAlive = this.ctx.createOscillator();
    this._keepAlive.frequency.value = 20;
    this._keepAlive.connect(this._gain);
    this._gain.connect(this.ctx.destination);
    this._node.connect(this._gain);
    this._keepAlive.start();

    document.addEventListener('pointerdown', this._onGesture);
    document.addEventListener('keydown', this._onGesture);
    await this.resume();
    this._sync();
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // needs a user gesture; pointerdown handler will retry
      }
    }
  }

  setMetronome({ bpm, enabled } = {}) {
    if (bpm != null) this._bpm = bpm;
    if (enabled != null) this._enabled = !!enabled;
    this._sync();
    this.resume();
  }

  setTick(hz) {
    this._tickHz = Math.max(0, Math.min(60, Number(hz) || 0));
    this._node?.port.postMessage({ tickHz: this._tickHz });
    if (this._tickHz) this.resume();
  }

  _sync() {
    this._node?.port.postMessage({
      bpm: this._bpm,
      enabled: this._enabled,
    });
  }

  stopMetronome() {
    this.setMetronome({ enabled: false });
  }
}
