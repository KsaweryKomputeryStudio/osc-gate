/**
 * Persisted osc-gate configuration (localStorage).
 * Survives restarts; migrates the old DualSense-only key.
 */

import { normalizeDestinations, normalizeInSources, normalizeRouting } from './oscRouting.js';

const STORAGE_KEY = 'osc-gate-config';
const LEGACY_KEY = 'dualsense-osc-config';

export const DEFAULT_CONFIG = {
  version: 1,
  osc: {
    host: '127.0.0.1',
    port: 57121,
    destinations: [{ id: 'default', name: 'Primary', host: '127.0.0.1', port: 57121 }],
    routing: {},
    inSources: [],
    wsUrl: 'ws://127.0.0.1:8081',
    inPort: 9001,
    hz: 60,
    streaming: false,
  },
  ui: {
    sidebarCollapsed: false,
    oscInCollapsed: false,
    oscInMode: 'compact',
    oscInHeight: 280,
    activeSection: 'controller',
    inEndpointOpen: {},
    sectionsOpen: {
      controller: true,
      garmin: true,
      macbook: true,
      weather: true,
      mic: true,
      time: true,
      human: true,
    },
  },
  controller: {
    ignoreImu: true,
  },
  garmin: {
    deviceId: '',
    autoConnect: false,
    trendWindowSec: 30,
    trendRangeBpm: 20,
    trendSmooth: false,
    trendSmoothSec: 2,
    normalizeHr: false,
    hrMin: 40,
    hrMax: 200,
    sendBeats: true,
  },
  macbook: {
    autoConnect: false,
    closedDeg: 12,
    angleMax: 180,
  },
  weather: {
    lat: null,
    lon: null,
    place: '',
    zoom: 4,
    intervalSec: 60,
    autoFetch: false,
    fields: {
      temp: true,
      feels: false,
      humidity: false,
      humidity01: true,
      windSpeed: true,
      windDir: false,
      windDir01: true,
      windGust: false,
      clouds: true,
      pressure: false,
      precip: true,
      code: false,
      isDay: true,
      lat: false,
      lon: false,
    },
  },
  mic: {
    deviceId: '',
    autoConnect: false,
    sensitivity: 6,
    smoothing: 0.65,
  },
  time: {
    autoStart: false,
    weekStart: 1,
    hz: 4,
    fields: {
      day: true,
      week: true,
      month: true,
      year: true,
    },
  },
  human: {
    deviceId: '',
    autoConnect: false,
    confidence: 0.35,
    countMode: 'off',
    countMin: 0,
    countMax: 8,
  },
};

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function mergeDeep(base, extra) {
  const out = { ...base };
  if (!isPlainObject(extra)) return out;
  for (const [key, value] of Object.entries(extra)) {
    if (isPlainObject(base[key]) && isPlainObject(value)) {
      out[key] = mergeDeep(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function fromLegacy(parsed) {
  return mergeDeep(DEFAULT_CONFIG, {
    osc: {
      host: parsed.host || DEFAULT_CONFIG.osc.host,
      port: Number(parsed.port) || DEFAULT_CONFIG.osc.port,
      wsUrl: parsed.wsUrl || DEFAULT_CONFIG.osc.wsUrl,
      hz: Number(parsed.hz) || DEFAULT_CONFIG.osc.hz,
      streaming: !!parsed.streaming,
    },
    controller: {
      ignoreImu:
        parsed.ignoreImu != null
          ? !!parsed.ignoreImu
          : parsed.ignoreAccel != null
            ? !!parsed.ignoreAccel
            : true,
    },
  });
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeLoaded(mergeDeep(DEFAULT_CONFIG, JSON.parse(raw)));

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = normalizeLoaded(fromLegacy(JSON.parse(legacy)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // fall through
  }
  return structuredClone(DEFAULT_CONFIG);
}

function normalizeLoaded(cfg) {
  const destinations = normalizeDestinations(cfg.osc);
  const inPort = Number(cfg.osc.inPort);
  cfg.osc = {
    ...cfg.osc,
    destinations,
    routing: normalizeRouting(cfg.osc.routing),
    inSources: normalizeInSources(cfg.osc.inSources),
    host: destinations[0].host,
    port: destinations[0].port,
    inPort: Number.isInteger(inPort) && inPort >= 1 && inPort <= 65535 ? inPort : 9001,
  };
  return cfg;
}

export function saveConfig(partial = {}) {
  const next = mergeDeep(loadConfig(), partial);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
