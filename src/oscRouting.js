/**
 * OSC destinations + source→dest routing.
 * Missing routing cells default to true (everything goes everywhere).
 */

export const OSC_SOURCES = [
  { id: 'controller', label: 'Controller', prefix: '/ds' },
  { id: 'garmin', label: 'Garmin HR', prefix: '/garmin' },
  { id: 'macbook', label: 'MacBook', prefix: '/mac' },
];

export function newDestId() {
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function inSourceId(from) {
  return `in:${String(from || 'unknown')}`;
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
  return list.filter(Boolean).map((s, i) => {
    const from = String(s.from || '').trim() || `unknown:${i}`;
    return {
      id: String(s.id || inSourceId(from)),
      from,
      name: String(s.name || from),
      endpoints: normalizeEndpoints(s.endpoints),
    };
  });
}

export function routingSources(inSources = []) {
  return [
    ...OSC_SOURCES,
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
