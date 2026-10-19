/**
 * Incoming OSC profiles. DataOSC (Anton Heestand) groups /data/… endpoints
 * and draws a small live viz per group.
 */

import { firstNumber } from './oscInScale.js';

export const IN_PROFILES = [
  { id: 'none', label: 'None' },
  { id: 'dataosc', label: 'DataOSC' },
];

export function normalizeProfileId(id) {
  return id === 'dataosc' ? 'dataosc' : id === 'none' ? 'none' : '';
}

export function looksLikeDataOsc(address) {
  return String(address || '').startsWith('/data/');
}

const DATAOSC_GROUPS = [
  { id: 'compass', label: 'Compass', viz: 'compass', match: (a) => a.startsWith('/data/compass/') },
  {
    id: 'accel',
    label: 'Accelerometer',
    viz: 'xyz',
    match: (a) => a.startsWith('/data/motion/accelerometer/'),
  },
  {
    id: 'gyro',
    label: 'Gyroscope',
    viz: 'xyz',
    match: (a) => a.startsWith('/data/motion/gyroscope/'),
  },
  {
    id: 'attitude',
    label: 'Attitude',
    viz: 'xyz',
    match: (a) => a.startsWith('/data/motion/attitude') || a.startsWith('/data/attitude/'),
  },
  {
    id: 'motion',
    label: 'Motion',
    viz: 'meters',
    match: (a) => a.startsWith('/data/motion/'),
  },
  { id: 'mic', label: 'Microphone', viz: 'mic', match: (a) => a.startsWith('/data/microphone/') },
  { id: 'location', label: 'Location', viz: 'map', match: (a) => a.startsWith('/data/location/') },
  {
    id: 'face',
    label: 'Face',
    viz: 'meters',
    match: (a) => a.startsWith('/data/face') || a.includes('/faceTracking') || a.includes('/face/'),
  },
  {
    id: 'body',
    label: 'Body',
    viz: 'meters',
    match: (a) => a.startsWith('/data/body') || a.includes('/bodyTracking') || a.includes('/body/'),
  },
  {
    id: 'controller',
    label: 'Game controller',
    viz: 'meters',
    match: (a) => /\/data\/(game|controller|gamepad|gc)/i.test(a),
  },
  { id: 'other', label: 'Other', viz: 'meters', match: (a) => a.startsWith('/data/') },
];

export function resolveInProfile(src, addresses = []) {
  const explicit = normalizeProfileId(src?.profile);
  if (explicit) return explicit;
  if ((addresses || []).some(looksLikeDataOsc)) return 'dataosc';
  return 'none';
}

export function groupIncomingAddresses(profileId, addresses) {
  const list = [...new Set(addresses || [])].filter(Boolean).sort();
  if (normalizeProfileId(profileId) !== 'dataosc') {
    return [{ id: 'all', label: '', viz: null, addresses: list }];
  }
  const used = new Set();
  const groups = [];
  for (const g of DATAOSC_GROUPS) {
    const addrs = list.filter((a) => !used.has(a) && g.match(a));
    if (!addrs.length) continue;
    addrs.forEach((a) => used.add(a));
    groups.push({ id: g.id, label: g.label, viz: g.viz, addresses: addrs });
  }
  const rest = list.filter((a) => !used.has(a));
  if (rest.length) groups.push({ id: 'ungrouped', label: 'Other', viz: 'meters', addresses: rest });
  return groups;
}

export function rawNumber(liveMap, address) {
  const slot = liveMap?.get?.(address);
  const n = firstNumber(slot?.raw);
  return Number.isFinite(n) ? n : null;
}

function pickAddr(addresses, suffix) {
  const needle = String(suffix).toLowerCase();
  return (
    addresses.find((a) => a.toLowerCase().endsWith(needle)) ||
    addresses.find((a) => a.toLowerCase().includes(needle)) ||
    ''
  );
}

export function readLocationCoords(addresses, liveMap) {
  const lat =
    rawNumber(liveMap, pickAddr(addresses, '/latitude')) ??
    rawNumber(liveMap, pickAddr(addresses, '/lat'));
  const lon =
    rawNumber(liveMap, pickAddr(addresses, '/longitude')) ??
    rawNumber(liveMap, pickAddr(addresses, '/lon')) ??
    rawNumber(liveMap, pickAddr(addresses, '/lng'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  for (const address of addresses || []) {
    const raw = liveMap?.get?.(address)?.raw;
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const a = Number(raw[0]);
    const b = Number(raw[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { lat: a, lon: b };
    }
  }
  return { lat: null, lon: null };
}

export function paintProfileViz(canvas, group, liveMap) {
  if (!canvas || !group?.viz || group.viz === 'map') return;
  const w = canvas.clientWidth || 168;
  const h = canvas.clientHeight || 168;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (group.viz === 'compass') drawCompass(ctx, w, h, group.addresses, liveMap);
  else if (group.viz === 'xyz') drawXyz(ctx, w, h, group.addresses, liveMap);
  else if (group.viz === 'mic') drawMic(ctx, w, h, group.addresses, liveMap);
  else drawMeters(ctx, w, h, group.addresses, liveMap);
}

function drawCompass(ctx, w, h, addresses, liveMap) {
  const headingAddr = pickAddr(addresses, '/magneticnorth') || pickAddr(addresses, '/heading') || pickAddr(addresses, '/north');
  const heading = rawNumber(liveMap, headingAddr);
  const cx = w / 2;
  const cy = h / 2 + 6;
  const r = Math.min(w, h) * 0.38;
  ctx.strokeStyle = 'rgba(255,140,0,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy);
  if (heading != null) ctx.rotate((-deg(heading) * Math.PI) / 180);
  ctx.strokeStyle = 'rgba(255,140,0,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const inner = i % 9 === 0 ? r - 12 : r - 6;
    ctx.beginPath();
    ctx.moveTo(Math.sin(a) * inner, -Math.cos(a) * inner);
    ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgb(255,140,0)';
  ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -r + 22);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('E', r - 22, 0);
  ctx.fillText('S', 0, r - 22);
  ctx.fillText('W', -r + 22, 0);
  ctx.restore();

  ctx.fillStyle = 'rgb(255,140,0)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 4);
  ctx.lineTo(cx - 7, cy - r + 18);
  ctx.lineTo(cx + 7, cy - r + 18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(heading == null ? '—' : `${Math.round(deg(heading))}°`, cx, 16);
}

function deg(v) {
  if (!Number.isFinite(v)) return 0;
  if (v >= 0 && v <= 1.0001) return v * 360;
  return ((v % 360) + 360) % 360;
}

function drawXyz(ctx, w, h, addresses, liveMap) {
  const axes = [
    { key: '/x', label: 'X' },
    { key: '/y', label: 'Y' },
    { key: '/z', label: 'Z' },
  ].map((a) => ({ ...a, v: rawNumber(liveMap, pickAddr(addresses, a.key)) }));
  const span = Math.max(1, ...axes.map((a) => (a.v == null ? 0 : Math.abs(a.v))));
  const rowH = h / 3;
  axes.forEach((a, i) => {
    const y = i * rowH + rowH / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.label, 4, y);
    const x0 = 22;
    const x1 = w - 52;
    const mid = (x0 + x1) / 2;
    ctx.strokeStyle = 'rgba(255,140,0,0.2)';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.moveTo(mid, y - 6);
    ctx.lineTo(mid, y + 6);
    ctx.stroke();
    if (a.v == null) return;
    const t = a.v / span;
    const x = mid + t * (x1 - mid);
    ctx.strokeStyle = 'rgb(255,140,0)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mid, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(a.v.toFixed(2), w - 4, y);
  });
}

function drawMic(ctx, w, h, addresses, liveMap) {
  const amp = rawNumber(liveMap, pickAddr(addresses, '/amplitude'));
  const norm = rawNumber(liveMap, pickAddr(addresses, '/normalizedlevel'));
  const rows = [
    { label: 'amp', v: amp, max: Math.max(0.2, amp == null ? 0.2 : Math.abs(amp) * 1.4) },
    { label: 'lvl', v: norm, max: 1 },
  ];
  const rowH = h / 2;
  rows.forEach((row, i) => {
    const y = 8 + i * rowH;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, 4, y + 4);
    const x0 = 36;
    const bw = w - 86;
    ctx.fillStyle = 'rgba(255,140,0,0.12)';
    ctx.fillRect(x0, y, bw, 14);
    if (row.v == null) return;
    const t = Math.min(1, Math.max(0, row.v / row.max));
    ctx.fillStyle = 'rgb(255,140,0)';
    ctx.fillRect(x0, y, bw * t, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(row.v.toFixed(3), w - 4, y + 12);
  });
}

function drawMeters(ctx, w, h, addresses, liveMap) {
  const rows = addresses.filter((a) => !a.endsWith('/active')).slice(0, 6);
  if (!rows.length) {
    ctx.fillStyle = 'rgba(255,140,0,0.4)';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No numeric channels yet', w / 2, h / 2);
    return;
  }
  const rowH = h / rows.length;
  rows.forEach((addr, i) => {
    const v = rawNumber(liveMap, addr);
    const y = i * rowH + 4;
    const label = addr.split('/').filter(Boolean).slice(-1)[0] || addr;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 4, y + 10);
    const x0 = 78;
    const bw = w - 128;
    ctx.fillStyle = 'rgba(255,140,0,0.12)';
    ctx.fillRect(x0, y, bw, 12);
    if (v == null) return;
    const t = v >= 0 && v <= 1 ? v : Math.min(1, Math.abs(v) / Math.max(1, Math.abs(v)));
    ctx.fillStyle = 'rgb(255,140,0)';
    ctx.fillRect(x0, y, bw * t, 12);
    ctx.fillStyle = '#fff';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Number(v).toFixed(2), w - 4, y + 10);
  });
}
