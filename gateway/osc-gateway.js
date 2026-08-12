/**
 * DualSense OSC Gateway
 *
 * Bridges WebHID (browser) ↔ WebSocket ↔ OSC UDP.
 *
 * Outbound frames are packed into a single OSC #bundle (one UDP datagram)
 * so receivers like TouchDesigner Data OSC stay low-latency. Previous
 * per-address UDP floods (~40 packets/frame) caused queue buildup.
 *
 * Env / CLI:
 *   OSC_OUT_HOST   default 127.0.0.1
 *   OSC_OUT_PORT   default 9000
 *   OSC_IN_PORT    default 9001
 *   WS_PORT        default 8081
 *   OSC_DISCRETE=1 send one UDP packet per address (legacy / SuperCollider)
 */

import { WebSocketServer } from 'ws';
import osc from 'osc';
import dgram from 'node:dgram';

const OSC_OUT_HOST = process.env.OSC_OUT_HOST || '127.0.0.1';
const OSC_OUT_PORT = Number(process.env.OSC_OUT_PORT || 9000);
const OSC_IN_PORT = Number(process.env.OSC_IN_PORT || 9001);
const WS_PORT = Number(process.env.WS_PORT || 8081);
const OSC_DISCRETE = process.env.OSC_DISCRETE === '1';

/** @type {import('ws').WebSocket | null} */
let browserClient = null;

let outHost = OSC_OUT_HOST;
let outPort = OSC_OUT_PORT;

/** Latest pending outbound messages (overwrite = drop backlog). */
let pendingMessages = null;
let flushScheduled = false;
let packetsSent = 0;
let framesSent = 0;
let framesDropped = 0;

const udpSocket = dgram.createSocket('udp4');

const udpPort = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: OSC_IN_PORT,
  metadata: true,
});

udpPort.on('ready', () => {
  console.log(`[OSC] listening (in)  udp://0.0.0.0:${OSC_IN_PORT}`);
  console.log(`[OSC] sending  (out)  udp://${outHost}:${outPort}`);
  console.log(`[OSC] mode: ${OSC_DISCRETE ? 'discrete messages' : 'bundled (1 UDP / frame)'}`);
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

function enqueueOscMessages(messages) {
  if (!messages?.length) return;
  if (pendingMessages) framesDropped++;
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

  try {
    if (OSC_DISCRETE) {
      for (const m of messages) {
        udpSocket.send(Buffer.from(encodeMessage(m)), outPort, outHost);
        packetsSent++;
      }
    } else {
      // One UDP datagram for the whole frame — matches how Data OSC stays responsive
      udpSocket.send(Buffer.from(encodeBundle(messages)), outPort, outHost);
      packetsSent++;
    }
    framesSent++;
  } catch (err) {
    console.error('[OSC] send failed:', err.message);
  }
}

function sendOscMessage(address, args) {
  enqueueOscMessages([{ address, args }]);
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
      oscIn: { port: OSC_IN_PORT },
      wsPort: WS_PORT,
      discrete: OSC_DISCRETE,
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
  udpPort.close();
  udpSocket.close();
  wss.close();
  process.exit(0);
});
