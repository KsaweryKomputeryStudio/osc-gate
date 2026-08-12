/**
 * DualSense OSC Gateway
 *
 * Bridges WebHID (browser) ↔ WebSocket ↔ OSC UDP.
 * Browsers cannot send UDP, so this Node process owns OSC I/O.
 *
 * Outbound uses latest-wins coalescing so a slow OSC receiver
 * cannot accumulate latency from a HID flood.
 *
 * Env / CLI:
 *   OSC_OUT_HOST   default 127.0.0.1
 *   OSC_OUT_PORT   default 9000   (send controller → world)
 *   OSC_IN_PORT    default 9001   (receive world → controller)
 *   WS_PORT        default 8081   (browser bridge)
 */

import { WebSocketServer } from 'ws';
import osc from 'osc';
import dgram from 'node:dgram';

const OSC_OUT_HOST = process.env.OSC_OUT_HOST || '127.0.0.1';
const OSC_OUT_PORT = Number(process.env.OSC_OUT_PORT || 9000);
const OSC_IN_PORT = Number(process.env.OSC_IN_PORT || 9001);
const WS_PORT = Number(process.env.WS_PORT || 8081);

/** @type {import('ws').WebSocket | null} */
let browserClient = null;

/** Live OSC destination (browser can override via WS). */
let outHost = OSC_OUT_HOST;
let outPort = OSC_OUT_PORT;

/** Latest pending outbound messages (overwrite = drop backlog). */
let pendingMessages = null;
let flushScheduled = false;
let packetsSent = 0;
let packetsDropped = 0;

const udpSocket = dgram.createSocket('udp4');

const udpPort = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: OSC_IN_PORT,
  metadata: true,
  socket: undefined,
});

udpPort.on('ready', () => {
  console.log(`[OSC] listening (in)  udp://0.0.0.0:${OSC_IN_PORT}`);
  console.log(`[OSC] sending  (out)  udp://${outHost}:${outPort}`);
});

udpPort.on('message', (msg, timeTag, info) => {
  if (!browserClient || browserClient.readyState !== 1) return;

  browserClient.send(
    JSON.stringify({
      type: 'osc',
      address: msg.address,
      args: (msg.args || []).map((a) => ({
        type: a.type,
        value: a.value,
      })),
      from: info ? `${info.address}:${info.port}` : null,
    }),
  );
});

udpPort.on('error', (err) => {
  console.error('[OSC] error:', err.message);
});

udpPort.open();

function encodeMessage(m) {
  return osc.writePacket({
    address: m.address,
    args: (m.args || []).map((v) => {
      if (typeof v === 'number') return { type: 'f', value: v };
      if (typeof v === 'string') return { type: 's', value: v };
      if (typeof v === 'boolean') return { type: 'f', value: v ? 1 : 0 };
      return { type: 'f', value: Number(v) || 0 };
    }),
  });
}

/**
 * Queue messages with latest-wins: a new frame replaces an unsent one.
 */
function enqueueOscMessages(messages) {
  if (!messages?.length) return;
  if (pendingMessages) packetsDropped += pendingMessages.length;
  pendingMessages = messages;
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

  for (const m of messages) {
    try {
      const buf = Buffer.from(encodeMessage(m));
      udpSocket.send(buf, outPort, outHost);
      packetsSent++;
    } catch (err) {
      console.error('[OSC] send failed:', err.message);
      break;
    }
  }
}

function sendOscMessage(address, args) {
  enqueueOscMessages([{ address, args }]);
}

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`[WS]  browser bridge  ws://127.0.0.1:${WS_PORT}`);
  console.log('[tip] open the Vite app, connect DualSense, enable OSC in the OSC tab');
});

wss.on('connection', (ws) => {
  console.log('[WS] browser connected');
  browserClient = ws;

  ws.send(
    JSON.stringify({
      type: 'hello',
      oscOut: { host: outHost, port: outPort },
      oscIn: { port: OSC_IN_PORT },
      wsPort: WS_PORT,
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
      if (msg.host) outHost = String(msg.host);
      if (msg.port) outPort = Number(msg.port);
      console.log(`[OSC] out retargeted → udp://${outHost}:${outPort}`);
      ws.send(JSON.stringify({ type: 'config_ack', host: outHost, port: outPort }));
      return;
    }

    if (msg.type === 'bundle' && Array.isArray(msg.messages)) {
      enqueueOscMessages(msg.messages);
      return;
    }

    if (msg.type === 'message' && msg.address) {
      sendOscMessage(msg.address, msg.args || []);
    }
  });

  ws.on('close', () => {
    console.log('[WS] browser disconnected');
    if (browserClient === ws) browserClient = null;
  });
});

setInterval(() => {
  if (packetsSent || packetsDropped) {
    console.log(`[OSC] sent=${packetsSent}/s dropped_frames≈${packetsDropped}`);
    packetsSent = 0;
    packetsDropped = 0;
  }
}, 1000);

process.on('SIGINT', () => {
  udpPort.close();
  udpSocket.close();
  wss.close();
  process.exit(0);
});
