import { stateToOscMessages, applyOscControl } from './oscNormalize.js';

const DEFAULT_HZ = 60;
const FLOAT_EPS = 0.002;

/**
 * Browser ↔ OSC gateway WebSocket client.
 *
 * Uses latest-wins throttling so HID (~250Hz) cannot flood the network
 * and build unbounded latency in the receiver's UDP queue.
 */
export class OscBridge {
  constructor({
    wsUrl = 'ws://127.0.0.1:8081',
    hz = DEFAULT_HZ,
    onStatus,
    onControl,
  } = {}) {
    this.wsUrl = wsUrl;
    this.hz = hz;
    this.onStatus = onStatus || (() => {});
    this.onControl = onControl || (() => {});
    this.ws = null;
    this.enabled = false;
    this.host = '127.0.0.1';
    this.port = 9000;
    this._reconnectTimer = null;
    this._wantConnect = false;
    this._latestState = null;
    this._flushTimer = null;
    this._lastSent = new Map();
    this.stats = { sentBundles: 0, recvMessages: 0, dropped: 0 };
  }

  setDestination(host, port) {
    this.host = host;
    this.port = Number(port);
    this._send({ type: 'config', host: this.host, port: this.port });
  }

  setHz(hz) {
    this.hz = Math.max(1, Math.min(250, Number(hz) || DEFAULT_HZ));
    if (this.enabled) this._restartFlush();
  }

  connect() {
    this._wantConnect = true;
    this._open();
  }

  disconnect() {
    this._wantConnect = false;
    this.enabled = false;
    this._stopFlush();
    clearTimeout(this._reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onStatus({ connected: false, enabled: false });
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) {
      this._lastSent.clear();
      this._restartFlush();
    } else {
      this._stopFlush();
      this._latestState = null;
    }
    this.onStatus({
      connected: !!(this.ws && this.ws.readyState === WebSocket.OPEN),
      enabled: this.enabled,
    });
  }

  _open() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      this.onStatus({ connected: false, enabled: this.enabled, error: err.message });
      this._scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      this._send({ type: 'config', host: this.host, port: this.port });
      this.onStatus({ connected: true, enabled: this.enabled });
      if (this.enabled) this._restartFlush();
    });

    this.ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === 'hello' || msg.type === 'config_ack') {
        this.onStatus({
          connected: true,
          enabled: this.enabled,
          oscOut: msg.oscOut || { host: this.host, port: this.port },
          oscIn: msg.oscIn,
        });
        return;
      }

      if (msg.type === 'osc') {
        this.stats.recvMessages++;
        this.onControl(msg.address, msg.args || []);
      }
    });

    this.ws.addEventListener('close', () => {
      this.onStatus({ connected: false, enabled: this.enabled });
      this.ws = null;
      this._stopFlush();
      if (this._wantConnect) this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {});
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      if (this._wantConnect) this._open();
    }, 1500);
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Drop if the socket is already back-pressured
      if (this.ws.bufferedAmount > 256 * 1024) {
        this.stats.dropped++;
        return false;
      }
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  _restartFlush() {
    this._stopFlush();
    const interval = Math.round(1000 / this.hz);
    this._flushTimer = setInterval(() => this._flush(), interval);
  }

  _stopFlush() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  }

  /**
   * Store latest HID state only — never queue frames (latest-wins).
   * Actual OSC emit happens on the throttle timer.
   */
  sendState(state) {
    if (!this.enabled) return;
    if (this._latestState) this.stats.dropped++;
    this._latestState = state;
  }

  _flush() {
    if (!this.enabled || !this._latestState) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const state = this._latestState;
    this._latestState = null;

    const all = stateToOscMessages(state);
    const changed = this._diff(all);
    if (!changed.length) return;

    if (this._send({ type: 'bundle', messages: changed })) {
      this.stats.sentBundles++;
    }
  }

  _diff(messages) {
    const out = [];
    for (const m of messages) {
      const key = m.address;
      const args = m.args || [];
      const prev = this._lastSent.get(key);
      if (prev && argsEqual(args, prev, FLOAT_EPS)) continue;
      this._lastSent.set(key, args.slice());
      out.push(m);
    }
    return out;
  }
}

function argsEqual(a, b, eps) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (Math.abs(x - y) > eps) return false;
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

export { applyOscControl, stateToOscMessages };
