/**
 * OSC destinations + source→dest routing.
 * Missing routing cells default to true (everything goes everywhere).
 */

export const OSC_SOURCES = [
  { id: 'controller', label: 'DualSense', prefix: '/ds' },
  { id: 'garmin', label: 'Garmin HR', prefix: '/garmin' },
  { id: 'macbook', label: 'MacBook', prefix: '/mac' },
  { id: 'weather', label: 'Weather', prefix: '/weather' },
  { id: 'mic', label: 'Microphone', prefix: '/mic' },
  { id: 'soundcard', label: 'Soundcard', prefix: '/soundcard' },
  { id: 'time', label: 'Time', prefix: '/time' },
  { id: 'human', label: 'Human count', prefix: '/human' },
  { id: 'hands', label: 'Hands', prefix: '/hands' },
  { id: 'encoder', label: 'Encoder', prefix: '/encoder' },
];

export function newDestId() {
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Host part of an incoming UDP sender. Drops the ephemeral source port. */
export function incomingHost(from) {
  let host = String(from || '').trim();
  if (!host || host === 'unknown') return '';
  if (host.startsWith('in:')) host = host.slice(3);
  if (host.startsWith('::ffff:')) host = host.slice(7);
  const v4 = host.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4) return v4[1];
  const bracket = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) return bracket[1];
  return host;
}

export function inSourceId(from) {
  return `in:${incomingHost(from) || String(from || 'unknown').trim() || 'unknown'}`;
}

export function normalizeDestinations(osc = {}) {
  const host = String(osc.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(osc.port) || 57121;
  let list = Array.isArray(osc.destinations) ? osc.destinations.filter(Boolean) : [];
  if (!list.length) {
    list = [{ id: 'default', name: 'Primary', host, port }];
  }
  return list.map((d, i) => ({
    id: String(d.id || `d${i}`),
    name: String(d.name || (i === 0 ? 'Primary' : `Dest ${i + 1}`)),
    host: String(d.host || host).trim() || host,
    port: Number(d.port) || port,
  }));
}

export function normalizeEndpoints(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for (const [addr, spec] of Object.entries(map)) {
    if (!addr) continue;
    const mode = spec?.mode === 'auto' || spec?.mode === 'manual' ? spec.mode : 'off';
    let min = Number(spec?.min);
    let max = Number(spec?.max);
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 1;
    out[addr] = { mode, min, max };
  }
  return out;
}

export function normalizeInSources(list) {
  if (!Array.isArray(list)) return [];
  const byId = new Map();
  list.filter(Boolean).forEach((s, i) => {
    const host = incomingHost(s.from) || incomingHost(s.id) || `unknown:${i}`;
    const id = inSourceId(host);
    const endpoints = normalizeEndpoints(s.endpoints);
    const defaultName = !s.name || s.name === s.from || s.name === s.id || incomingHost(s.name) === host;
    const name = defaultName ? host : String(s.name);
    const existing = byId.get(id);
    const profile = s.profile === 'dataosc' || s.profile === 'none' ? s.profile : existing?.profile || '';
    if (!existing) {
      byId.set(id, { id, from: host, name, endpoints, profile });
      return;
    }
    existing.endpoints = { ...existing.endpoints, ...endpoints };
    if (!defaultName) existing.name = name;
    if (profile) existing.profile = profile;
  });
  return [...byId.values()];
}

/** Fold legacy in:IP:port routing rows onto in:IP. */
export function remapIncomingRouting(routing) {
  const src = normalizeRouting(routing);
  const next = {};
  for (const [id, row] of Object.entries(src)) {
    const key = id.startsWith('in:') ? inSourceId(id) : id;
    next[key] = { ...(next[key] || {}), ...(row || {}) };
  }
  return next;
}

export function routingSources(inSources = [], instances = []) {
  const rows = (instances || []).map((s) => ({
    id: s.id,
    label: s.name || s.type,
  }));
  return [
    ...rows,
    ...normalizeInSources(inSources).map((s) => ({
      id: s.id,
      label: s.name || s.from,
    })),
  ];
}

export function normalizeRouting(routing) {
  return routing && typeof routing === 'object' && !Array.isArray(routing) ? routing : {};
}

export function isRouted(routing, sourceId, destId) {
  const row = routing?.[sourceId];
  if (!row || row[destId] === undefined) return true;
  return !!row[destId];
}

export function setRoute(routing, sourceId, destId, on) {
  return {
    ...normalizeRouting(routing),
    [sourceId]: {
      ...(routing?.[sourceId] || {}),
      [destId]: !!on,
    },
  };
}

export function pruneRouting(routing, destIds) {
  const allow = new Set(destIds);
  const next = {};
  for (const [sourceId, row] of Object.entries(normalizeRouting(routing))) {
    const trimmed = {};
    for (const [destId, val] of Object.entries(row || {})) {
      if (allow.has(destId)) trimmed[destId] = val;
    }
    next[sourceId] = trimmed;
  }
  return next;
}

export function destLabel(d) {
  if (!d) return '—';
  const hp = `${d.host}:${d.port}`;
  return d.name && d.name !== 'Primary' ? `${d.name} (${hp})` : hp;
}
