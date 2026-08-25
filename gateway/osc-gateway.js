/**
 * DATA-DRIVER OSC Gateway
 *
 * Bridges browser sources (WebHID / Web Bluetooth) ↔ WebSocket ↔ OSC UDP.
 *
 * Outbound frames are packed into a single OSC #bundle (one UDP datagram)
 * so receivers like TouchDesigner Data OSC stay low-latency. Previous
 * per-address UDP floods (~40 packets/frame) caused queue buildup.
 *
 * Env / CLI:
 *   OSC_OUT_HOST   default 127.0.0.1
 *   OSC_OUT_PORT   default 57121,
 *   OSC_IN_PORT    default 9001
 *   WS_PORT        default 8081
 *   OSC_DISCRETE=1 send one UDP packet per address (legacy / SuperCollider)
 */

import { WebSocketServer } from 'ws';
import osc from 'osc';
import dgram from 'node:dgram';
import { MacbookLidPoller, probeLidSensor } from './macbookLid.js';
import { argValue, asNumber, normalizeSpec, observeRange, transformArgs } from '../src/oscInScale.js';

const OSC_OUT_HOST = process.env.OSC_OUT_HOST || '127.0.0.1';
const OSC_OUT_PORT = Number(process.env.OSC_OUT_PORT || 57121);
const OSC_IN_PORT = Number(process.env.OSC_IN_PORT || 9001);
const WS_PORT = Number(process.env.WS_PORT || 8081);
const OSC_DISCRETE = process.env.OSC_DISCRETE === '1';

/** @type {import('ws').WebSocket | null} */
let browserClient = null;

let macbookInfo = { native: false, available: false };
const macbookLid = new MacbookLidPoller({
  onSample: (sample) => {
    if (browserClient && browserClient.readyState === 1) {
      browserClient.send(JSON.stringify({ type: 'macbook-sample', ...sample }));
    }
  },
  onStatus: (status) => {
    if (browserClient && browserClient.readyState === 1) {
      browserClient.send(JSON.stringify({ type: 'macbook-status', ...status }));
    }
  },
});

probeLidSensor()
  .then((info) => {
    macbookInfo = info;
    if (info.available) console.log(`[mac] lid sensor ready (${info.name})`);
    else if (info.native) console.log('[mac] node-hid loaded, no lid sensor on this machine');
    else console.log(`[mac] native lid reader unavailable: ${info.error || 'node-hid missing'}`);
  })
  .catch(() => {});

let destinations = [{ id: 'default', host: OSC_OUT_HOST, port: OSC_OUT_PORT, name: 'Primary' }];
let routing = {};
let outHost = OSC_OUT_HOST;
let outPort = OSC_OUT_PORT;
let inPort = OSC_IN_PORT;

/** Latest pending outbound messages (overwrite = drop backlog). */
let pendingMessages = null;
let flushScheduled = false;
let packetsSent = 0;
let framesSent = 0;
let framesDropped = 0;

const udpSocket = dgram.createSocket('udp4');

/** @type {import('osc').UDPPort | null} */
let udpIn = null;

function bindIncoming(port) {
  port.on('ready', () => {
    console.log(`[OSC] listening (in)  udp://0.0.0.0:${inPort}`);
  });
  port.on('message', (msg, timeTag, info) => {
    const from = info ? `${info.address}:${info.port}` : 'unknown';
    const sourceId = `in:${from}`;
    const transformed = transformIncomingArgs(sourceId, msg.address, msg.args || []);
    passthroughIncoming({ address: msg.address, args: transformed.args }, sourceId, from);
    if (!browserClient || browserClient.readyState !== 1) return;
    browserClient.send(
      JSON.stringify({
        type: 'osc',
        address: msg.address,
        args: (msg.args || []).map((a) => ({
          type: a.type,
          value: a.value,
        })),
        outArgs: (transformed.args || []).map((a) =>
          a && typeof a === 'object' && 'value' in a ? { type: a.type || 'f', value: a.value } : { type: 'f', value: a },
        ),
        autoMin: transformed.autoMin,
        autoMax: transformed.autoMax,
        from,
        sourceId,
      }),
    );
  });
  port.on('error', (err) => {
    console.error('[OSC] in error:', err.message);
  });
}

function openIncoming(port) {
  const next = Number(port);
  if (!Number.isInteger(next) || next < 1 || next > 65535) return inPort;
  if (udpIn && inPort === next) return inPort;
  const prev = udpIn;
  udpIn = null;
  inPort = next;
  const start = () => {
    udpIn = new osc.UDPPort({
      localAddress: '0.0.0.0',
      localPort: inPort,
      metadata: true,
    });
    bindIncoming(udpIn);
    udpIn.open();
  };
  if (prev) {
    try {
      prev.close();
    } catch {
      // ignore
    }
    setTimeout(start, 40);
  } else {
    start();
  }
  return inPort;
}

openIncoming(OSC_IN_PORT);
console.log(`[OSC] sending  (out)  udp://${outHost}:${outPort}`);
console.log(`[OSC] mode: ${OSC_DISCRETE ? 'discrete messages' : 'bundled (1 UDP / frame)'}`);

function toOscArgs(args) {
  return (args || []).map((v) => {
    if (typeof v === 'number') return { type: 'f', value: v };
    if (typeof v === 'string') return { type: 's', value: v };
    if (typeof v === 'boolean') return { type: 'f', value: v ? 1 : 0 };
    return { type: 'f', value: Number(v) || 0 };
  });
}

function encodeBundle(messages) {
  return osc.writePacket({
    timeTag: osc.timeTag(0),
    packets: messages.map((m) => ({
      address: m.address,
      args: toOscArgs(m.args),
    })),
  });
}

function encodeMessage(m) {
  return osc.writePacket({
    address: m.address,
    args: toOscArgs(m.args),
  });
}

function isLocalHost(host) {
  const h = String(host || '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::';
}

function sameHost(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (x === y) return true;
  return isLocalHost(x) && isLocalHost(y);
}

function destWouldLoop(dest, from) {
  const match = String(from || '').match(/^(.*):(\d+)$/);
  const fromHost = match?.[1];
  const fromPort = match ? Number(match[2]) : NaN;
  if (Number(dest.port) === inPort && isLocalHost(dest.host)) return true;
  if (fromHost && Number(dest.port) === fromPort && sameHost(dest.host, fromHost)) return true;
  return false;
}

function encodeIncoming(msg) {
  return osc.writePacket({
    address: msg.address,
    args: (msg.args || []).map((a) => {
      if (a && typeof a === 'object' && a.type) return a;
      if (typeof a === 'string') return { type: 's', value: a };
      if (typeof a === 'number') return { type: 'f', value: a };
      return { type: 'f', value: Number(a) || 0 };
    }),
  });
}

let inSourceSpecs = {};
/** @type {Record<string, { min: number, max: number }>} */
const autoRange = Object.create(null);

function rangeKey(sourceId, address) {
  return `${sourceId}\0${address}`;
}

function transformIncomingArgs(sourceId, address, args) {
  const spec = inSourceSpecs[sourceId]?.[address];
  const key = rangeKey(sourceId, address);
  if (spec?.resetAuto) {
    delete autoRange[key];
    spec.resetAuto = false;
  }
  for (const v of args || []) {
    const n = asNumber(argValue(v));
    if (n != null) autoRange[key] = observeRange(autoRange[key], n);
  }
  return transformArgs(args, spec, autoRange[key] || null);
}

function passthroughIncoming(msg, sourceId, from) {
  if (!msg?.address) return;
  const dests = destinations.length ? destinations : [{ id: 'default', host: outHost, port: outPort }];
  let buf;
  try {
    buf = Buffer.from(encodeIncoming(msg));
  } catch (err) {
    console.error('[OSC] passthrough encode failed:', err.message);
    return;
  }
  try {
    for (const dest of dests) {
      if (!isRouted(sourceId, dest.id)) continue;
      if (destWouldLoop(dest, from)) continue;
      udpSocket.send(buf, dest.port, dest.host);
      packetsSent++;
    }
  } catch (err) {
    console.error('[OSC] passthrough send failed:', err.message);
  }
}

function isRouted(source, destId) {
  if (!source) return true;
  const row = routing[source];
  if (!row || row[destId] === undefined) return true;
  return !!row[destId];
}

function enqueueOscMessages(messages, source) {
  if (!messages?.length) return;
  const tagged = messages.map((m) => ({ ...m, source: m.source || source || 'unknown' }));
  if (pendingMessages) {
    const merged = new Map(pendingMessages.map((m) => [`${m.source}:${m.address}`, m]));
    for (const m of tagged) merged.set(`${m.source}:${m.address}`, m);
    pendingMessages = [...merged.values()];
  } else {
    pendingMessages = tagged;
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setImmediate(flushPending);
}

function flushPending() {
  flushScheduled = false;
  const messages = pendingMessages;
  pendingMessages = null;
  if (!messages?.length) return;

  const dests = destinations.length ? destinations : [{ id: 'default', host: outHost, port: outPort }];
  try {
    for (const dest of dests) {
      const msgs = messages.filter((m) => isRouted(m.source, dest.id));
      if (!msgs.length) continue;
      if (OSC_DISCRETE) {
        for (const m of msgs) {
          udpSocket.send(Buffer.from(encodeMessage(m)), dest.port, dest.host);
          packetsSent++;
        }
      } else {
        udpSocket.send(Buffer.from(encodeBundle(msgs)), dest.port, dest.host);
        packetsSent++;
      }
    }
    framesSent++;
  } catch (err) {
    console.error('[OSC] send failed:', err.message);
  }
}

function sendOscMessageNow(address, args, source) {
  const dests = destinations.length ? destinations : [{ id: 'default', host: outHost, port: outPort }];
  try {
    const buf = Buffer.from(encodeMessage({ address, args }));
    for (const dest of dests) {
      if (!isRouted(source, dest.id)) continue;
      udpSocket.send(buf, dest.port, dest.host);
      packetsSent++;
    }
  } catch (err) {
    console.error('[OSC] send failed:', err.message);
  }
}

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`[WS]  browser bridge  ws://127.0.0.1:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  console.log('[WS] browser connected');
  browserClient = ws;

  ws.send(
    JSON.stringify({
      type: 'hello',
      oscOut: { host: outHost, port: outPort },
      oscIn: { port: inPort },
      wsPort: WS_PORT,
      discrete: OSC_DISCRETE,
      macbook: macbookInfo,
    }),
  );

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'config') {
      if (Array.isArray(msg.destinations) && msg.destinations.length) {
        destinations = msg.destinations.map((d, i) => ({
          id: String(d.id || `d${i}`),
          name: String(d.name || `Dest ${i + 1}`),
          host: String(d.host || '127.0.0.1').trim(),
          port: Number(d.port) || 57121,
        }));
        outHost = destinations[0].host;
        outPort = destinations[0].port;
        console.log(
          `[OSC] destinations → ${destinations.map((d) => `${d.host}:${d.port}`).join(', ')}`,
        );
      } else {
        if (msg.host) outHost = String(msg.host);
        if (msg.port) outPort = Number(msg.port);
        if (destinations[0]) {
          destinations[0] = { ...destinations[0], host: outHost, port: outPort };
        }
        console.log(`[OSC] out retargeted → udp://${outHost}:${outPort}`);
      }
      if (msg.routing && typeof msg.routing === 'object') routing = msg.routing;
      if (msg.inPort != null) openIncoming(msg.inPort);
      if (Array.isArray(msg.inSources)) {
        inSourceSpecs = {};
        for (const s of msg.inSources) {
          const id = String(s.id || '');
          if (!id) continue;
          const endpoints = {};
          for (const [addr, raw] of Object.entries(s.endpoints && typeof s.endpoints === 'object' ? s.endpoints : {})) {
            const spec = normalizeSpec(raw);
            endpoints[String(addr)] = spec;
            if (raw?.resetAuto || spec.resetAuto) {
              delete autoRange[rangeKey(id, addr)];
              spec.resetAuto = false;
            }
          }
          inSourceSpecs[id] = endpoints;
        }
      }
      ws.send(
        JSON.stringify({
          type: 'config_ack',
          host: outHost,
          port: outPort,
          destinations,
          oscIn: { port: inPort },
        }),
      );
      return;
    }

    if (msg.type === 'macbook') {
      macbookLid.setOptions({
        closedDeg: msg.closedDeg,
        angleMax: msg.angleMax,
      });
      if (msg.enabled) {
        macbookLid.start().catch((err) => {
          ws.send(
            JSON.stringify({
              type: 'macbook-status',
              connected: false,
              error: err.message,
            }),
          );
        });
      } else {
        macbookLid.stop();
      }
      return;
    }

    if (msg.type === 'bundle' && Array.isArray(msg.messages)) {
      enqueueOscMessages(msg.messages, msg.source);
      return;
    }

    if (msg.type === 'message' && msg.address) {
      sendOscMessageNow(msg.address, msg.args || [], msg.source);
    }
  });

  ws.on('close', () => {
    console.log('[WS] browser disconnected');
    if (browserClient === ws) browserClient = null;
  });
});

setInterval(() => {
  if (framesSent || framesDropped || packetsSent) {
    console.log(
      `[OSC] frames=${framesSent}/s udp_packets=${packetsSent}/s dropped_frames=${framesDropped}`,
    );
    framesSent = 0;
    framesDropped = 0;
    packetsSent = 0;
  }
}, 1000);

process.on('SIGINT', () => {
  macbookLid.stop();
  try {
    udpIn?.close();
  } catch {
    // ignore
  }
  udpSocket.close();
  wss.close();
  process.exit(0);
});
