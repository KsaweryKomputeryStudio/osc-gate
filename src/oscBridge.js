import { stateToOscMessages, applyOscControl } from './oscNormalize.js';

const DEFAULT_HZ = 60;
const FLOAT_EPS = 0.0005; // matches quantize(1/1000)

/**
 * Browser ↔ OSC gateway WebSocket client.
 *
 * HID-driven latest-wins throttling (not setInterval).
 * Chrome throttles timers hard in background tabs; DualSense inputreport
 * callbacks keep firing, so we emit from those events when the Hz budget allows.
 */
export class OscBridge {
  constructor({
    wsUrl = 'ws://127.0.0.1:8081',
    hz = DEFAULT_HZ,
    onStatus,
    onControl,
    onGateway,
    onIncoming,
  } = {}) {
    this.wsUrl = wsUrl;
    this.hz = hz;
    this.onStatus = onStatus || (() => {});
    this.onControl = onControl || (() => {});
    this.onGateway = onGateway || (() => {});
    this.onIncoming = onIncoming || (() => {});
    this.ws = null;
    this.enabled = false;
    this.host = '127.0.0.1';
    this.port = 57121;
    this._reconnectTimer = null;
    this._wantConnect = false;
    this._latestState = null;
    this._lastFlushMs = 0;
    this._lastSent = new Map();
    this.ignoreImu = false;
    this.controlSource = 'controller';
    this.controlPrefix = '/ds';
    this.onOutgoing = null;
    this.filterOutgoing = null;
    this.destinations = [];
    this.routing = {};
    this.inSources = [];
    this.inPort = 9001;
    this.stats = { sentBundles: 0, recvMessages: 0, dropped: 0 };
  }

  setDestination(host, port) {
    this.host = host;
    this.port = Number(port);
    if (this.destinations[0]) {
      this.destinations[0] = { ...this.destinations[0], host: this.host, port: this.port };
    }
    this._pushRouting();
  }

  setDestinations(destinations, routing, inPort, inSources) {
    if (Array.isArray(destinations)) this.destinations = destinations;
    if (routing) this.routing = routing;
    if (inPort != null) this.inPort = Number(inPort) || this.inPort;
    if (Array.isArray(inSources)) this.inSources = inSources;
    if (this.destinations[0]) {
      this.host = this.destinations[0].host;
      this.port = this.destinations[0].port;
    }
    this._pushRouting();
  }

  _pushRouting() {
    this._send({
      type: 'config',
      host: this.host,
      port: this.port,
      inPort: this.inPort,
      destinations: this.destinations,
      routing: this.routing,
      inSources: this.inSources,
    });
  }

  setHz(hz) {
    this.hz = Math.max(1, Math.min(250, Number(hz) || DEFAULT_HZ));
  }

  setIgnoreImu(on) {
    this.ignoreImu = !!on;
    for (const key of [...this._lastSent.keys()]) {
      if (key.startsWith('/ds/gyro') || key.startsWith('/ds/accel') || key === '/ds/sensor/timestamp') {
        this._lastSent.delete(key);
      }
    }
  }

  connect() {
    this._wantConnect = true;
    this._open();
  }

  waitUntilOpen(ms = 1500) {
    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), ms);
      const onOpen = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.ws?.addEventListener('open', onOpen, { once: true });
    });
  }

  disconnect() {
    this._wantConnect = false;
    this.enabled = false;
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
      this._lastFlushMs = 0;
    } else {
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
      this._pushRouting();
      this.onStatus({ connected: true, enabled: this.enabled });
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
        this.onGateway(msg);
        return;
      }

      if (msg.type === 'macbook-sample' || msg.type === 'macbook-status') {
        this.onGateway(msg);
        return;
      }

      if (msg.type === 'osc') {
        this.stats.recvMessages++;
        this.onIncoming(msg);
        this.onControl(msg.address, msg.args || []);
      }
    });

    this.ws.addEventListener('close', () => {
      this.onStatus({ connected: false, enabled: this.enabled });
      this.ws = null;
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

  send(obj) {
    return this._send(obj);
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.ws.bufferedAmount > 256 * 1024) {
        this.stats.dropped++;
        return false;
      }
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  /**
   * Send OSC messages immediately (Garmin HR/trend, etc.).
   * Continuous values are change-diffed unless `force` is set.
   */
  sendMessages(messages, { force = false, source = 'controller', processed = false } = {}) {
    if (!this.enabled) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const allowed = !processed && this.filterOutgoing ? this.filterOutgoing(source, messages) : messages;
    const out = force ? allowed : this._diff(allowed, source);
    if (!out.length) return;
    if (this._send({ type: 'bundle', source, messages: out })) {
      this.stats.sentBundles++;
    }
  }

  /** Fire-and-forget trigger (bypasses latest-wins bundle queue). */
  sendTrigger(address, value = 1, { source = 'controller' } = {}) {
    if (!this.enabled) return;
    const messages = [{ address, args: [Number(value)] }];
    const allowed = this.filterOutgoing ? this.filterOutgoing(source, messages) : messages;
    if (!allowed.length) return;
    this._send({ type: 'message', source, address: allowed[0].address, args: allowed[0].args });
  }

  /**
   * Called from HID inputreport. Sends immediately when Hz budget allows.
   * Avoids setInterval so background browser tabs stay responsive.
   */
  sendState(state) {
    if (!this.enabled) return;
    if (this._latestState) this.stats.dropped++;
    this._latestState = state;

    const interval = 1000 / this.hz;
    const now = performance.now();
    if (now - this._lastFlushMs >= interval) {
      this._flush(now);
    }
  }

  _flush(now = performance.now()) {
    if (!this.enabled || !this._latestState) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const state = this._latestState;
    this._latestState = null;
    this._lastFlushMs = now;

    let all = stateToOscMessages(state, { ignoreImu: this.ignoreImu });
    if (this.controlPrefix && this.controlPrefix !== '/ds') {
      all = all.map((m) => ({
        ...m,
        address: m.address.startsWith('/ds') ? `${this.controlPrefix}${m.address.slice(3)}` : m.address,
      }));
    }
    const source = this.controlSource || 'controller';
    const changed = this._diff(all, source);
    if (changed.length) this.onOutgoing?.(source, changed);
    const send = this.filterOutgoing ? this.filterOutgoing(source, changed) : changed;
    if (!send.length) return;

    if (this._send({ type: 'bundle', source, messages: send })) {
      this.stats.sentBundles++;
    }
  }

  _diff(messages, source = 'controller') {
    const out = [];
    for (const m of messages) {
      const key = `${source}:${m.address}`;
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
