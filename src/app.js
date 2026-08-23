import { DualSenseDevice, normalizeStick, normalizeTrigger } from './dualsense.js';
import { OscBridge, applyOscControl } from './oscBridge.js';
import { loadConfig, saveConfig } from './config.js';
import { GarminHrSource, hrToOsc, trendToOsc } from './garminHr.js';
import { MacbookSensorSource } from './macbookSensors.js';
import { GeoMap } from './geoMap.js';
import { WeatherSource, WEATHER_FIELDS, DEFAULT_WEATHER_FIELDS, weatherToOsc, searchPlaces } from './weatherSource.js';
import { MicSource } from './micSource.js';
import { TimeSource, TIME_FIELDS, DEFAULT_TIME_FIELDS, timeToOsc } from './timeSource.js';
import { HumanCountSource, countToOsc } from './humanSource.js';
import { startPerlinBg } from './perlinBg.js';
import { AudioClock } from './audioClock.js';
import {
  destLabel,
  inSourceId,
  isRouted,
  newDestId,
  pruneRouting,
  routingSources,
  setRoute,
} from './oscRouting.js';
import { setupOscInMonitor } from './oscInMonitor.js';
import { argVals, asNumber, firstNumber, observeRange, transformArgs } from './oscInScale.js';

const TOUCHPAD_W = 1920;
const TOUCHPAD_H = 1080;
const GARMIN_CHART_WINDOW_MS = 60_000;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let controller = null;
let reportCount = 0;
let lastReportTime = performance.now();
let hz = 0;
let motionHistory = { gyroX: [], gyroY: [], gyroZ: [] };
const HISTORY_LEN = 120;

let oscBridge = null;
let oscWantStream = false;
let oscGwConnected = false;

let garmin = null;
let garminBeatsSent = 0;
let garminBeatPulseTimer = null;
let garminChartTimer = null;
let audioClock = null;
const garminOsc = { hr: [], trend: [], beat: [] };

let macbook = null;
let macbookChartTimer = null;
let oscInMonitor = { push() {}, renderSources() {}, render() {} };
const inLive = new Map();
const inAuto = new Map();
let inChartTimer = null;
let macbookNativeWait = null;
let macbookUsingNative = false;
const macbookOsc = { angle: [], open: [] };

let weather = null;
let weatherMap = null;
let weatherSendTimer = null;
let weatherChartTimer = null;
const weatherOsc = { temp: [], wind: [] };

let mic = null;
let micChartTimer = null;
const micOsc = { level: [] };

let timeSource = null;
let human = null;
let humanCountAuto = null;

const stickCanvases = {
  left: { canvas: $('#stick-left'), ctx: null },
  right: { canvas: $('#stick-right'), ctx: null },
};

function init() {
  startPerlinBg('perlinBg', [255, 140, 0]);
  stickCanvases.left.ctx = stickCanvases.left.canvas.getContext('2d');
  stickCanvases.right.ctx = stickCanvases.right.canvas.getContext('2d');
  drawStick(stickCanvases.left.ctx, stickCanvases.left.canvas, 0, 0);
  drawStick(stickCanvases.right.ctx, stickCanvases.right.canvas, 0, 0);

  if (!('hid' in navigator)) {
    $('#webhid-warning').classList.remove('hidden');
    $('#connect-btn').disabled = true;
    $('#connect-btn-2').disabled = true;
  }

  if (!GarminHrSource.isSupported()) {
    $('#webbluetooth-warning')?.classList.remove('hidden');
    $('#garmin-connect-btn').disabled = true;
    $('#garmin-connect-btn-2').disabled = true;
  }

  if (!MacbookSensorSource.isSupported()) {
    $('#macbook-hid-warning')?.classList.remove('hidden');
    if ($('#macbook-connect-btn')) $('#macbook-connect-btn').disabled = true;
    if ($('#macbook-connect-btn-2')) $('#macbook-connect-btn-2').disabled = true;
  }

  if (!MicSource.isSupported()) {
    $('#mic-warning')?.classList.remove('hidden');
    if ($('#mic-connect-btn')) $('#mic-connect-btn').disabled = true;
    if ($('#mic-connect-btn-2')) $('#mic-connect-btn-2').disabled = true;
  }

  if (!HumanCountSource.isSupported()) {
    $('#human-warning')?.classList.remove('hidden');
    if ($('#human-connect-btn')) $('#human-connect-btn').disabled = true;
    if ($('#human-connect-btn-2')) $('#human-connect-btn-2').disabled = true;
  }

  $('#connect-btn').addEventListener('click', connect);
  $('#connect-btn-2')?.addEventListener('click', connect);
  $('#disconnect-btn').addEventListener('click', disconnect);

  setupOutputControls();
  setupFeatureReports();
  setupSidebar();
  setupOscUi();
  setupGarminUi();
  setupMacbookUi();
  setupWeatherUi();
  setupMicUi();
  setupTimeUi();
  setupHumanUi();
  oscInMonitor = setupOscInMonitor({
    $,
    $$,
    loadConfig,
    saveConfig,
    getInSources: () => loadConfig().osc.inSources || [],
    onDiscover: upsertIncomingSource,
    onRename: renameIncomingSource,
    onRemove: removeIncomingSource,
  });
  ensureGatewayConnection();
  ensureAudioClock();
  document.addEventListener('pointerdown', () => ensureAudioClock());
  document.addEventListener('keydown', () => ensureAudioClock());
  checkExistingDevices();

  navigator.hid?.addEventListener('connect', checkExistingDevices);
  navigator.hid?.addEventListener('disconnect', onHidDisconnect);
}

function getOscIgnoreImu() {
  return !!$('#controller-ignore-imu')?.checked;
}

function applyControllerOptions() {
  const ignoreImu = getOscIgnoreImu();
  saveConfig({ controller: { ignoreImu } });
  oscBridge?.setIgnoreImu(ignoreImu);
  return ignoreImu;
}

function applyOscOptions() {
  const hzVal = Number($('#osc-modal-hz')?.value || 60);
  const inPort = Number($('#osc-modal-in-port')?.value || loadConfig().osc.inPort || 9001);
  const dests = readDestinationsFromUi() || loadConfig().osc.destinations;
  const osc = loadConfig().osc;
  saveConfig({
    osc: {
      host: dests[0]?.host || '127.0.0.1',
      port: dests[0]?.port || 57121,
      destinations: dests,
      routing: osc.routing || {},
      wsUrl: $('#osc-ws-url')?.value,
      inPort,
      hz: hzVal,
      streaming: oscWantStream,
    },
  });
  oscBridge?.setHz(hzVal);
  oscBridge?.setIgnoreImu(getOscIgnoreImu());
  pushDestinationsToGateway();
}

function updateOscDestLabel() {
  const dests = loadConfig().osc.destinations || [];
  const first = dests[0];
  const text = !first
    ? 'no destination'
    : dests.length === 1
      ? `${first.host}:${first.port}`
      : `${first.host}:${first.port} +${dests.length - 1}`;
  const el = $('#osc-dest-label');
  if (el) el.textContent = text;
  const display = $('#osc-dest-display');
  if (display) display.value = dests.map((d) => `udp://${d.host}:${d.port}`).join(' · ');
  updateOscInLabel();
}

function updateOscInLabel(port) {
  const p = Number(port) || loadConfig().osc.inPort || 9001;
  if ($('#osc-in-port')) $('#osc-in-port').textContent = `udp://0.0.0.0:${p}`;
}

function pushDestinationsToGateway() {
  const osc = loadConfig().osc;
  oscBridge?.setDestinations(osc.destinations, osc.routing, osc.inPort, osc.inSources);
}

function readDestinationsFromUi() {
  const rows = [...document.querySelectorAll('#osc-dest-list .osc-dest-row')];
  if (!rows.length) return null;
  return rows.map((row, i) => ({
    id: row.dataset.id || `d${i}`,
    name: row.querySelector('.dest-name')?.value.trim() || (i === 0 ? 'Primary' : `Dest ${i + 1}`),
    host: row.querySelector('.dest-host')?.value.trim() || '127.0.0.1',
    port: Number(row.querySelector('.dest-port')?.value) || 57121,
  }));
}

function renderDestinationEditor() {
  const list = $('#osc-dest-list');
  if (!list) return;
  const dests = loadConfig().osc.destinations || [];
  list.innerHTML = dests
    .map(
      (d) => `<div class="osc-dest-row" data-id="${d.id}">
        <input class="dest-name text-input" placeholder="Name" value="${escapeAttr(d.name)}" />
        <input class="dest-host text-input" placeholder="127.0.0.1" value="${escapeAttr(d.host)}" />
        <input class="dest-port text-input" type="number" min="1" max="65535" value="${d.port}" />
        <button type="button" class="dest-remove" ${dests.length < 2 ? 'disabled' : ''} aria-label="Remove">×</button>
      </div>`,
    )
    .join('');
  list.querySelectorAll('.dest-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.osc-dest-row')?.dataset.id;
      removeDestination(id);
    });
  });
  list.querySelectorAll('.dest-name, .dest-host, .dest-port').forEach((input) => {
    input.addEventListener('change', () => {
      persistDestinationsFromUi();
      renderRoutingMatrix();
      pushDestinationsToGateway();
    });
  });
  renderRoutingMatrix();
}

function persistDestinationsFromUi() {
  const dests = readDestinationsFromUi();
  if (!dests?.length) return null;
  saveConfig({
    osc: {
      destinations: dests,
      host: dests[0].host,
      port: dests[0].port,
    },
  });
  updateOscDestLabel();
  return dests;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function addDestination(host = '127.0.0.1', port = 57121) {
  persistDestinationsFromUi();
  const osc = loadConfig().osc;
  const dests = [...(osc.destinations || []), { id: newDestId(), name: `Dest ${(osc.destinations || []).length + 1}`, host, port }];
  saveConfig({ osc: { destinations: dests, host: dests[0].host, port: dests[0].port } });
  renderDestinationEditor();
  updateOscDestLabel();
  pushDestinationsToGateway();
}

function removeDestination(id) {
  persistDestinationsFromUi();
  const osc = loadConfig().osc;
  if ((osc.destinations || []).length < 2) return;
  const dests = osc.destinations.filter((d) => d.id !== id);
  const routing = pruneRouting(osc.routing, dests.map((d) => d.id));
  saveConfig({ osc: { destinations: dests, routing, host: dests[0].host, port: dests[0].port } });
  renderDestinationEditor();
  updateOscDestLabel();
  pushDestinationsToGateway();
}

function upsertIncomingSource(from) {
  const addr = String(from || '').trim();
  if (!addr || addr === 'unknown') return;
  const osc = loadConfig().osc;
  const id = inSourceId(addr);
  const list = osc.inSources || [];
  if (list.some((s) => s.id === id)) return;
  saveConfig({ osc: { inSources: [...list, { id, from: addr, name: addr, endpoints: {} }] } });
  renderRoutingMatrix();
  renderInSourceNav();
  oscInMonitor.renderSources?.();
  pushDestinationsToGateway();
}

function renameIncomingSource(id, name) {
  const osc = loadConfig().osc;
  const list = (osc.inSources || []).map((s) =>
    s.id === id ? { ...s, name: String(name || '').trim() || s.from } : s,
  );
  saveConfig({ osc: { inSources: list } });
  renderRoutingMatrix();
  renderInSourceNav();
  oscInMonitor.renderSources?.();
  oscInMonitor.render?.();
  if (currentInSourceId() === id) renderInSourceView(id);
}

function removeIncomingSource(id) {
  const osc = loadConfig().osc;
  const list = (osc.inSources || []).filter((s) => s.id !== id);
  const routing = { ...(osc.routing || {}) };
  delete routing[id];
  saveConfig({ osc: { inSources: list, routing } });
  inLive.delete(id);
  for (const key of [...inAuto.keys()]) {
    if (key.startsWith(`${id}\0`)) inAuto.delete(key);
  }
  renderRoutingMatrix();
  renderInSourceNav();
  oscInMonitor.renderSources?.();
  oscInMonitor.render?.();
  pushDestinationsToGateway();
  if (currentInSourceId() === id || loadConfig().ui.activeSection === id) {
    setActiveSection('controller');
  }
}

function renderRoutingMatrix() {
  const table = $('#osc-routing-matrix');
  if (!table) return;
  const osc = loadConfig().osc;
  const dests = osc.destinations || [];
  const routing = osc.routing || {};
  const sources = routingSources(osc.inSources);
  table.innerHTML = `<thead><tr><th></th>${dests
    .map((d) => `<th title="${escapeAttr(`${d.host}:${d.port}`)}">${escapeAttr(d.name || destLabel(d))}</th>`)
    .join('')}</tr></thead><tbody>${sources
    .map(
      (src) => `<tr><th title="${escapeAttr(src.id)}">${escapeAttr(src.label)}</th>${dests
        .map(
          (d) => `<td><input type="checkbox" data-src="${escapeAttr(src.id)}" data-dest="${d.id}" ${
            isRouted(routing, src.id, d.id) ? 'checked' : ''
          } /></td>`,
        )
        .join('')}</tr>`,
    )
    .join('')}</tbody>`;
  table.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const next = setRoute(loadConfig().osc.routing, box.dataset.src, box.dataset.dest, box.checked);
      saveConfig({ osc: { routing: next } });
      pushDestinationsToGateway();
    });
  });
}

function applyOscDestination() {
  const err = $('#osc-modal-error');
  const dests = persistDestinationsFromUi() || loadConfig().osc.destinations;
  const inPort = Number($('#osc-modal-in-port')?.value);
  for (const d of dests) {
    if (!isValidHost(d.host) || !isValidPort(d.port)) {
      if (err) {
        err.textContent = 'Each destination needs a valid IP/hostname and port (1–65535).';
        err.classList.remove('hidden');
      }
      return false;
    }
  }
  if (!isValidPort(inPort)) {
    if (err) {
      err.textContent = 'OSC input port must be 1–65535.';
      err.classList.remove('hidden');
    }
    return false;
  }
  if (err) err.classList.add('hidden');
  applyOscOptions();
  updateOscDestLabel();
  return true;
}

function openOscConfigModal() {
  const osc = loadConfig().osc;
  if ($('#osc-modal-in-port')) $('#osc-modal-in-port').value = String(osc.inPort || 9001);
  if ($('#osc-modal-hz')) $('#osc-modal-hz').value = String(osc.hz || 60);
  if ($('#osc-ws-url')) $('#osc-ws-url').value = osc.wsUrl;
  renderDestinationEditor();
  $('#osc-modal-error')?.classList.add('hidden');
  $('#osc-config-modal')?.classList.remove('hidden');
}

function closeOscConfigModal() {
  $('#osc-config-modal')?.classList.add('hidden');
}

function isValidHost(host) {
  if (!host || host.length > 253) return false;
  return /^(?:(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/.test(
    host,
  );
}

function isValidPort(port) {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function updateOscHeaderButton() {
  const btn = $('#osc-stream-btn');
  const dot = $('#osc-header-dot');
  if (!btn || !dot) return;

  const live = oscWantStream && oscGwConnected;
  const connecting = oscWantStream && !oscGwConnected;

  btn.classList.toggle('active', live);
  btn.classList.toggle('connecting', connecting);
  dot.classList.toggle('connected', live);
  dot.classList.toggle('connecting', connecting);

  btn.title = live
    ? 'OSC streaming — click to stop'
    : connecting
      ? 'Connecting to gateway… click to cancel'
      : 'Click to start OSC streaming';
}

function createOscBridge(url) {
  const saved = loadConfig();
  return new OscBridge({
    wsUrl: url,
    hz: Number($('#osc-modal-hz')?.value || saved.osc.hz || 60),
    onStatus: updateOscStatus,
    onGateway: onGatewayMessage,
    onIncoming: (msg) => {
      if (msg.from) upsertIncomingSource(msg.from);
      noteIncomingEndpoint(msg);
      oscInMonitor.push(msg);
    },
    onControl: (address, args) => {
      const handled = applyOscControl(controller, address, args);
      const argStr = args.map((a) => (typeof a === 'object' ? a.value : a)).join(' ');
      if ($('#osc-last')) {
        $('#osc-last').textContent = handled
          ? `${address} ${argStr}`
          : `${address} (unhandled)`;
      }
      if (handled) syncOutputUiFromController();
    },
  });
}

function ensureGatewayConnection() {
  const saved = loadConfig();
  const url = ($('#osc-ws-url')?.value || saved.osc.wsUrl || 'ws://127.0.0.1:8081').trim();
  if (!oscBridge) {
    oscBridge = createOscBridge(url);
    const osc = saved.osc;
    oscBridge.setHz(Number($('#osc-modal-hz')?.value || 60));
    oscBridge.setIgnoreImu(getOscIgnoreImu());
    oscBridge.setDestinations(osc.destinations, osc.routing, osc.inPort, osc.inSources);
    oscBridge.connect();
  }
  if (oscWantStream) oscBridge.setEnabled(true);
  return oscBridge;
}

function onGatewayMessage(msg) {
  if (msg.type === 'hello' && msg.macbook) {
    if (macbook?._want && msg.macbook.available && !macbookUsingNative) {
      oscBridge?.send({ type: 'macbook', enabled: true, ...macbookOptionsFromUi() });
    }
  }
  if (msg.type === 'macbook-status') {
    macbookUsingNative = !!msg.connected;
    if (macbook) macbook._want = !!msg.connected || !!msg.connecting;
    if (macbookNativeWait) {
      const resolve = macbookNativeWait;
      macbookNativeWait = null;
      resolve(!!msg.connected);
    }
    onMacbookStatus({
      connected: !!msg.connected,
      connecting: !!msg.connecting,
      sources: msg.sources || (msg.connected ? ['Lid angle'] : []),
      error: msg.error || '',
    });
  }
  if (msg.type === 'macbook-sample') {
    if (!macbookUsingNative) {
      macbookUsingNative = true;
      if (macbook) macbook._want = true;
      onMacbookStatus({ connected: true, sources: msg.sources || ['Lid angle'] });
    }
    onMacbookSample(msg);
  }
}

function startOscStreaming() {
  ensureAudioClock();
  const saved = loadConfig();
  const url = ($('#osc-ws-url')?.value || saved.osc.wsUrl || 'ws://127.0.0.1:8081').trim();
  oscWantStream = true;
  saveConfig({ osc: { streaming: true, wsUrl: url } });

  ensureGatewayConnection();
  oscBridge.setEnabled(true);

  if ($('#osc-enable')) {
    $('#osc-enable').checked = true;
    $('#osc-enable').disabled = false;
  }
  if ($('#osc-disconnect-btn')) $('#osc-disconnect-btn').disabled = false;
  if ($('#osc-connect-btn')) $('#osc-connect-btn').disabled = true;

  updateOscHeaderButton();
}

function stopOscStreaming() {
  oscWantStream = false;
  saveConfig({ osc: { streaming: false } });
  oscBridge?.setEnabled(false);

  if ($('#osc-enable')) {
    $('#osc-enable').checked = false;
    $('#osc-enable').disabled = false;
  }
  if ($('#osc-disconnect-btn')) $('#osc-disconnect-btn').disabled = true;
  if ($('#osc-connect-btn')) $('#osc-connect-btn').disabled = false;

  updateOscStatus({ connected: !!oscBridge?.ws && oscBridge.ws.readyState === 1, enabled: false });
}

function toggleOscStreaming() {
  if (oscWantStream) stopOscStreaming();
  else startOscStreaming();
}

function setupOscUi() {
  const saved = loadConfig();
  if ($('#osc-ws-url')) $('#osc-ws-url').value = saved.osc.wsUrl;
  if ($('#osc-modal-hz')) $('#osc-modal-hz').value = String(saved.osc.hz || 60);
  if ($('#osc-modal-in-port')) $('#osc-modal-in-port').value = String(saved.osc.inPort || 9001);
  if ($('#controller-ignore-imu')) $('#controller-ignore-imu').checked = saved.controller.ignoreImu;
  updateOscDestLabel();
  updateOscInLabel();
  updateOscHeaderButton();
  renderDestinationEditor();

  $('#osc-stream-btn')?.addEventListener('click', toggleOscStreaming);
  $('#osc-config-open')?.addEventListener('click', openOscConfigModal);
  $('#osc-config-open-tab')?.addEventListener('click', openOscConfigModal);

  $('#controller-ignore-imu')?.addEventListener('change', applyControllerOptions);

  $$('[data-close-osc-modal]').forEach((el) => {
    el.addEventListener('click', closeOscConfigModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#osc-config-modal')?.classList.contains('hidden')) {
      closeOscConfigModal();
    }
  });

  $('#osc-dest-add')?.addEventListener('click', () => addDestination());

  $('#osc-modal-apply')?.addEventListener('click', () => {
    if (applyOscDestination()) closeOscConfigModal();
  });

  $('#osc-connect-btn')?.addEventListener('click', () => startOscStreaming());
  $('#osc-disconnect-btn')?.addEventListener('click', () => stopOscStreaming());

  $('#osc-enable')?.addEventListener('change', (e) => {
    if (e.target.checked) startOscStreaming();
    else {
      oscBridge?.setEnabled(false);
      oscWantStream = false;
      saveConfig({ osc: { streaming: false } });
      updateOscHeaderButton();
    }
  });

  setInterval(() => {
    if (!oscBridge) return;
    if ($('#osc-sent')) $('#osc-sent').textContent = String(oscBridge.stats.sentBundles);
    if ($('#osc-recv')) $('#osc-recv').textContent = String(oscBridge.stats.recvMessages);
  }, 500);

  if (saved.osc.streaming) {
    setTimeout(() => startOscStreaming(), 150);
  }
}

function updateOscStatus({ connected, enabled, oscIn, error }) {
  oscGwConnected = !!connected;

  const parts = [];
  if (error) parts.push(`error: ${error}`);
  else parts.push(connected ? 'online' : 'offline');
  if (enabled || oscWantStream) parts.push(enabled ? 'streaming' : 'connecting');
  if ($('#osc-status')) $('#osc-status').textContent = parts.join(' · ');
  if (oscIn?.port && $('#osc-in-port')) {
    $('#osc-in-port').textContent = `udp://0.0.0.0:${oscIn.port}`;
  } else {
    updateOscInLabel();
  }
  updateOscDestLabel();
  updateOscHeaderButton();

  if (connected && oscWantStream && oscBridge && !oscBridge.enabled) {
    oscBridge.setEnabled(true);
  }
  if ($('#osc-enable')) {
    $('#osc-enable').disabled = !connected;
    $('#osc-enable').checked = !!(oscWantStream && connected);
  }
}

function setupSidebar() {
  const saved = loadConfig();
  const sidebar = $('#sidebar');

  if (saved.ui.sidebarCollapsed) sidebar?.classList.add('collapsed');

  setupInSourceNav();
  setActiveSection(saved.ui.activeSection || 'controller', { persist: false });

  $('#sidebar-toggle')?.addEventListener('click', () => {
    const collapsed = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', collapsed);
    saveConfig({ ui: { sidebarCollapsed: collapsed } });
  });

  $$('.nav-select').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveSection(btn.dataset.section);
    });
  });
}

function setActiveSection(id, { persist = true } = {}) {
  const isIn = String(id || '').startsWith('in:');
  $$('.nav-section').forEach((el) => {
    el.classList.toggle('active', el.dataset.section === id);
  });
  $('#view-controller')?.classList.toggle('hidden', id !== 'controller');
  $('#view-garmin')?.classList.toggle('hidden', id !== 'garmin');
  $('#view-macbook')?.classList.toggle('hidden', id !== 'macbook');
  $('#view-weather')?.classList.toggle('hidden', id !== 'weather');
  $('#view-mic')?.classList.toggle('hidden', id !== 'mic');
  $('#view-time')?.classList.toggle('hidden', id !== 'time');
  $('#view-human')?.classList.toggle('hidden', id !== 'human');
  $('#view-insource')?.classList.toggle('hidden', !isIn);
  if (persist) saveConfig({ ui: { activeSection: id } });
  if (id === 'garmin') requestAnimationFrame(drawGarminOscCharts);
  if (id === 'macbook') requestAnimationFrame(drawMacbookOscCharts);
  if (id === 'weather') requestAnimationFrame(() => weatherMap?.resize());
  if (id === 'mic') requestAnimationFrame(drawMicOscCharts);
  if (isIn) {
    renderInSourceView(id);
    startInSourceCharts();
  } else {
    stopInSourceCharts();
  }
}

function currentInSourceId() {
  const id = loadConfig().ui.activeSection;
  return String(id || '').startsWith('in:') ? id : null;
}

function fmtVals(vals) {
  return (
    (vals || [])
      .map((v) => {
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
        return String(v);
      })
      .join(' ') || '—'
  );
}

function autoKey(sourceId, address) {
  return `${sourceId}\0${address}`;
}

function endpointSpec(sourceId, address) {
  const src = (loadConfig().osc.inSources || []).find((s) => s.id === sourceId);
  return src?.endpoints?.[address] || { mode: 'off', min: 0, max: 1 };
}

function isEndpointOpen(sourceId, address) {
  return !!loadConfig().ui.inEndpointOpen?.[sourceId]?.[address];
}

function setEndpointOpen(sourceId, address, open) {
  const prev = loadConfig().ui.inEndpointOpen || {};
  saveConfig({
    ui: {
      inEndpointOpen: {
        ...prev,
        [sourceId]: { ...(prev[sourceId] || {}), [address]: !!open },
      },
    },
  });
}

function mergeAutoRange(sourceId, address, rawVals, msgMin, msgMax) {
  const key = autoKey(sourceId, address);
  let range = inAuto.get(key) || null;
  for (const v of rawVals || []) range = observeRange(range, asNumber(v) ?? v);
  if (msgMin != null) range = observeRange(range, msgMin);
  if (msgMax != null) range = observeRange(range, msgMax);
  if (range) inAuto.set(key, range);
  return range;
}

function computeOutVals(rawVals, spec, observed) {
  return argVals(transformArgs(rawVals, spec, observed).args);
}

function refreshLiveOut(sourceId, address) {
  const slot = inLive.get(sourceId)?.get(address);
  if (!slot) return;
  const spec = endpointSpec(sourceId, address);
  const observed = inAuto.get(autoKey(sourceId, address)) || {
    min: slot.autoMin,
    max: slot.autoMax,
  };
  slot.out = computeOutVals(slot.raw, spec, observed);
  slot.autoMin = observed?.min;
  slot.autoMax = observed?.max;
  if (slot.series?.length) {
    const last = slot.series[slot.series.length - 1];
    last.out = firstNumber(slot.out);
  }
  if (currentInSourceId() === sourceId) patchInSourceRow(address, slot, sourceId);
}

function setupInSourceNav() {
  const host = $('#nav-insources');
  if (!host) return;
  host.addEventListener('click', (e) => {
    const del = e.target.closest('.nav-in-del');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      removeIncomingSource(del.dataset.id);
      return;
    }
    const sel = e.target.closest('.nav-select');
    if (sel) setActiveSection(sel.dataset.section);
  });
  $('#insource-name')?.addEventListener('change', (e) => {
    const id = currentInSourceId();
    if (id) renameIncomingSource(id, e.target.value);
  });
  setupInSourceView();
  renderInSourceNav();
}

function setupInSourceView() {
  const root = $('#insource-endpoints');
  if (!root || root._bound) return;
  root._bound = true;
  root.addEventListener('click', (e) => {
    const id = currentInSourceId();
    if (!id) return;
    const modeBtn = e.target.closest('.insource-modes button');
    if (modeBtn) {
      const address = modeBtn.parentElement.dataset.addr;
      setEndpointSpec(id, address, { mode: modeBtn.dataset.mode });
      refreshLiveOut(id, address);
      renderInSourceView(id);
      return;
    }
    const reset = e.target.closest('.insource-reset');
    if (reset) {
      const address = reset.closest('.insource-ep')?.dataset.addr;
      if (!address) return;
      inAuto.delete(autoKey(id, address));
      setEndpointSpec(id, address, { mode: 'auto', resetAuto: true });
      refreshLiveOut(id, address);
      renderInSourceView(id);
      return;
    }
    const head = e.target.closest('.insource-ep-head');
    if (head) {
      const row = head.closest('.insource-ep');
      const address = row?.dataset.addr;
      if (!address) return;
      const open = !row.classList.contains('open');
      row.classList.toggle('open', open);
      setEndpointOpen(id, address, open);
      if (open) requestAnimationFrame(drawInSourceCharts);
    }
  });
  root.addEventListener('change', (e) => {
    const input = e.target.closest('.insource-min, .insource-max');
    if (!input) return;
    const id = currentInSourceId();
    const row = input.closest('.insource-ep');
    const address = row?.dataset.addr;
    if (!id || !address) return;
    if (endpointSpec(id, address).mode !== 'manual') return;
    setEndpointSpec(id, address, {
      min: Number(row.querySelector('.insource-min')?.value),
      max: Number(row.querySelector('.insource-max')?.value),
    });
    refreshLiveOut(id, address);
  });
}

function renderInSourceNav() {
  const host = $('#nav-insources');
  if (!host) return;
  const sources = loadConfig().osc.inSources || [];
  const active = loadConfig().ui.activeSection;
  host.innerHTML = sources
    .map(
      (s) => `<section class="nav-section ${s.id === active ? 'active' : ''}" data-section="${escapeAttr(s.id)}">
        <div class="nav-section-head">
          <button type="button" class="nav-select" data-section="${escapeAttr(s.id)}" title="${escapeAttr(s.from)}">
            <span class="nav-icon">IN</span>
            <span class="nav-label">${escapeHtml(s.name || s.from)}</span>
            <span class="nav-dot" data-in-dot="${escapeAttr(s.id)}"></span>
          </button>
          <button type="button" class="nav-in-del" data-id="${escapeAttr(s.id)}" aria-label="Remove source">×</button>
        </div>
      </section>`,
    )
    .join('');
}

function ensureIncomingEndpoint(sourceId, address) {
  if (!sourceId || !address) return false;
  const osc = loadConfig().osc;
  const src = (osc.inSources || []).find((s) => s.id === sourceId);
  if (!src) return false;
  if (src.endpoints?.[address]) return false;
  const list = (osc.inSources || []).map((s) => {
    if (s.id !== sourceId) return s;
    return { ...s, endpoints: { ...(s.endpoints || {}), [address]: { mode: 'off', min: 0, max: 1 } } };
  });
  saveConfig({ osc: { inSources: list } });
  pushDestinationsToGateway();
  return true;
}

function setEndpointSpec(sourceId, address, patch) {
  const osc = loadConfig().osc;
  const list = (osc.inSources || []).map((s) => {
    if (s.id !== sourceId) return s;
    const cur = s.endpoints?.[address] || { mode: 'off', min: 0, max: 1 };
    return { ...s, endpoints: { ...(s.endpoints || {}), [address]: { ...cur, ...patch } } };
  });
  saveConfig({ osc: { inSources: list } });
  const oscNext = loadConfig().osc;
  let sources = oscNext.inSources;
  if (patch.resetAuto) {
    sources = sources.map((s) => {
      if (s.id !== sourceId) return s;
      const endpoints = { ...(s.endpoints || {}) };
      if (endpoints[address]) endpoints[address] = { ...endpoints[address], resetAuto: true };
      return { ...s, endpoints };
    });
  }
  oscBridge?.setDestinations(oscNext.destinations, oscNext.routing, oscNext.inPort, sources);
}

function noteIncomingEndpoint(msg) {
  const id = msg.sourceId || (msg.from ? inSourceId(msg.from) : '');
  const address = String(msg.address || '');
  if (!id || !address) return;
  let map = inLive.get(id);
  if (!map) {
    map = new Map();
    inLive.set(id, map);
  }
  const prev = map.get(address);
  const raw = argVals(msg.args);
  const spec = endpointSpec(id, address);
  const observed = mergeAutoRange(id, address, raw, msg.autoMin, msg.autoMax);
  const out = computeOutVals(raw, spec, observed);
  const now = performance.now();
  const series = prev?.series ? prev.series.slice() : [];
  const rv = firstNumber(raw);
  if (rv != null) {
    series.push({ t: now, raw: rv, out: firstNumber(out) });
    const cutoff = now - GARMIN_CHART_WINDOW_MS - 1000;
    while (series.length > 1 && series[1].t < cutoff) series.shift();
  }
  map.set(address, {
    raw,
    out,
    autoMin: observed?.min,
    autoMax: observed?.max,
    series,
  });
  const added = ensureIncomingEndpoint(id, address);
  const dot = document.querySelector(`[data-in-dot="${CSS.escape(id)}"]`);
  if (dot) {
    dot.classList.add('connected');
    clearTimeout(dot._liveTimer);
    dot._liveTimer = setTimeout(() => dot.classList.remove('connected'), 2000);
  }
  if (currentInSourceId() !== id) return;
  if (added) renderInSourceView(id);
  else patchInSourceRow(address, map.get(address), id);
}

function patchInSourceRow(address, live, sourceId) {
  const row = [...document.querySelectorAll('#insource-endpoints .insource-ep')].find(
    (el) => el.dataset.addr === address,
  );
  if (!row) {
    renderInSourceView(sourceId);
    return;
  }
  const rawEl = row.querySelector('.insource-raw');
  const outEl = row.querySelector('.insource-out');
  if (rawEl) rawEl.textContent = fmtVals(live.raw);
  if (outEl) outEl.textContent = fmtVals(live.out);
  const spec = endpointSpec(sourceId, address);
  if (spec.mode === 'auto') {
    const minEl = row.querySelector('.insource-min');
    const maxEl = row.querySelector('.insource-max');
    if (minEl && live.autoMin != null) minEl.value = String(live.autoMin);
    if (maxEl && live.autoMax != null) maxEl.value = String(live.autoMax);
  }
}

function renderInSourceView(id) {
  const src = (loadConfig().osc.inSources || []).find((s) => s.id === id);
  if (!src) {
    setActiveSection('controller');
    return;
  }
  const nameEl = $('#insource-name');
  if (nameEl && document.activeElement !== nameEl) nameEl.value = src.name || src.from;
  if ($('#insource-from')) $('#insource-from').textContent = src.from;
  const root = $('#insource-endpoints');
  if (!root) return;
  const liveMap = inLive.get(id) || new Map();
  const addrs = [...new Set([...Object.keys(src.endpoints || {}), ...liveMap.keys()])].sort();
  if (!addrs.length) {
    root.innerHTML = '<p class="osc-hint">Waiting for incoming OSC endpoints…</p>';
    return;
  }
  root.innerHTML = addrs
    .map((address) => {
      const spec = src.endpoints?.[address] || { mode: 'off', min: 0, max: 1 };
      const live = liveMap.get(address) || {};
      const minVal = spec.mode === 'auto' && live.autoMin != null ? live.autoMin : spec.min;
      const maxVal = spec.mode === 'auto' && live.autoMax != null ? live.autoMax : spec.max;
      const auto = spec.mode === 'auto';
      const open = isEndpointOpen(id, address);
      const showRange = spec.mode !== 'off';
      return `<div class="panel insource-ep ${open ? 'open' : ''}" data-addr="${escapeAttr(address)}">
        <button type="button" class="insource-ep-head">
          <span class="insource-ep-caret">▾</span>
          <span class="insource-ep-addr">${escapeHtml(address)}</span>
          <span class="insource-ep-vals">
            <span>in <strong class="insource-raw">${escapeHtml(fmtVals(live.raw))}</strong></span>
            <span>out <strong class="insource-out">${escapeHtml(fmtVals(live.out))}</strong></span>
          </span>
        </button>
        <div class="insource-ep-body">
          <div class="insource-ep-norm">
            <div class="insource-modes" data-addr="${escapeAttr(address)}">
              <button type="button" data-mode="off" class="${spec.mode === 'off' ? 'active' : ''}">Off</button>
              <button type="button" data-mode="auto" class="${spec.mode === 'auto' ? 'active' : ''}">Auto 0–1</button>
              <button type="button" data-mode="manual" class="${spec.mode === 'manual' ? 'active' : ''}">Manual 0–1</button>
            </div>
            <div class="nav-row insource-range" ${showRange ? '' : 'hidden'}>
              <div class="control-group">
                <label>${auto ? 'Detected min' : 'Min'}</label>
                <input class="text-input insource-min" type="number" step="any" ${auto ? 'readonly' : ''} value="${minVal ?? ''}" />
              </div>
              <div class="control-group">
                <label>${auto ? 'Detected max' : 'Max'}</label>
                <input class="text-input insource-max" type="number" step="any" ${auto ? 'readonly' : ''} value="${maxVal ?? ''}" />
              </div>
              <button type="button" class="insource-reset" ${auto ? '' : 'hidden'}>Reset range</button>
            </div>
          </div>
          <div class="insource-ep-chart-wrap">
            <div class="insource-ep-legend">
              <span class="leg-raw">raw</span>
              ${spec.mode !== 'off' ? '<span class="leg-norm">0–1</span>' : ''}
            </div>
            <canvas class="hr-chart insource-ep-chart" data-ep-chart="${escapeAttr(address)}"></canvas>
          </div>
        </div>
      </div>`;
    })
    .join('');
  requestAnimationFrame(drawInSourceCharts);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function garminOptionsFromUi() {
  return {
    trendWindowSec: Number($('#garmin-trend-window')?.value || 30),
    trendRangeBpm: Number($('#garmin-trend-range')?.value || 20),
    trendSmooth: !!$('#garmin-trend-smooth')?.checked,
    trendSmoothSec: Number($('#garmin-trend-smooth-sec')?.value || 2),
    normalizeHr: !!$('#garmin-normalize-hr')?.checked,
    hrMin: Number($('#garmin-hr-min')?.value || 40),
    hrMax: Number($('#garmin-hr-max')?.value || 200),
    sendBeats: !!$('#garmin-send-beats')?.checked,
  };
}

function persistGarminOptions() {
  const prev = loadConfig().garmin;
  const opts = garminOptionsFromUi();
  saveConfig({ garmin: opts });
  garmin?.setOptions(opts);
  updateGarminHrRangeVisibility();
  updateGarminTrendSmoothVisibility();
  if (
    prev.normalizeHr !== opts.normalizeHr ||
    prev.hrMin !== opts.hrMin ||
    prev.hrMax !== opts.hrMax
  ) {
    garminOsc.hr = [];
  }
  if (opts.trendSmooth) {
    ensureAudioClock().then(() => syncGarminTrendTick());
  } else {
    syncGarminTrendTick();
  }
  return opts;
}

function updateGarminHrRangeVisibility() {
  const on = !!$('#garmin-normalize-hr')?.checked;
  $('#garmin-hr-range')?.classList.toggle('hidden', !on);
}

function updateGarminTrendSmoothVisibility() {
  const on = !!$('#garmin-trend-smooth')?.checked;
  $('#garmin-trend-smooth-sec-wrap')?.classList.toggle('hidden', !on);
}

function syncGarminTrendTick() {
  syncAudioTicks();
}

function syncAudioTicks() {
  const on = !!(garmin?.connected && garmin.trendSmooth) || !!macbook?.connected;
  audioClock?.setTick(on ? 30 : 0);
}

function setupGarminUi() {
  const saved = loadConfig().garmin;
  if ($('#garmin-trend-window')) $('#garmin-trend-window').value = String(saved.trendWindowSec);
  if ($('#garmin-trend-range')) $('#garmin-trend-range').value = String(saved.trendRangeBpm);
  if ($('#garmin-trend-smooth')) $('#garmin-trend-smooth').checked = !!saved.trendSmooth;
  if ($('#garmin-trend-smooth-sec')) $('#garmin-trend-smooth-sec').value = String(saved.trendSmoothSec ?? 2);
  if ($('#garmin-normalize-hr')) $('#garmin-normalize-hr').checked = !!saved.normalizeHr;
  if ($('#garmin-hr-min')) $('#garmin-hr-min').value = String(saved.hrMin);
  if ($('#garmin-hr-max')) $('#garmin-hr-max').value = String(saved.hrMax);
  if ($('#garmin-send-beats')) $('#garmin-send-beats').checked = saved.sendBeats !== false;
  updateGarminHrRangeVisibility();
  updateGarminTrendSmoothVisibility();

  garmin = new GarminHrSource({
    onSample: onGarminSample,
    onBeat: onGarminBeat,
    onStatus: onGarminStatus,
  });
  garmin.setOptions(saved);

  $('#garmin-connect-btn')?.addEventListener('click', connectGarmin);
  $('#garmin-connect-btn-2')?.addEventListener('click', connectGarmin);
  $('#garmin-disconnect-btn')?.addEventListener('click', () => disconnectGarmin({ forget: true }));

  [
    '#garmin-trend-window',
    '#garmin-trend-range',
    '#garmin-trend-smooth-sec',
    '#garmin-hr-min',
    '#garmin-hr-max',
  ].forEach((sel) => {
    $(sel)?.addEventListener('change', persistGarminOptions);
  });
  $('#garmin-trend-smooth')?.addEventListener('change', persistGarminOptions);
  $('#garmin-normalize-hr')?.addEventListener('change', persistGarminOptions);
  $('#garmin-send-beats')?.addEventListener('change', persistGarminOptions);

  if (saved.deviceId || saved.autoConnect) {
    setTimeout(() => {
      garmin.reconnect(saved.deviceId).catch(() => {});
    }, 250);
  }
}

function macbookOptionsFromUi() {
  return {
    closedDeg: Number($('#macbook-closed-deg')?.value || 12),
    angleMax: Number($('#macbook-angle-max')?.value || 180),
  };
}

function persistMacbookOptions() {
  const opts = macbookOptionsFromUi();
  saveConfig({ macbook: opts });
  macbook?.setOptions(opts);
  if (macbookUsingNative) {
    oscBridge?.send({ type: 'macbook', enabled: true, ...opts });
  }
  return opts;
}

function setupMacbookUi() {
  const saved = loadConfig().macbook || {};
  if ($('#macbook-closed-deg')) $('#macbook-closed-deg').value = String(saved.closedDeg ?? 12);
  if ($('#macbook-angle-max')) $('#macbook-angle-max').value = String(saved.angleMax ?? 180);

  macbook = new MacbookSensorSource({
    onSample: onMacbookSample,
    onStatus: onMacbookStatus,
  });
  macbook.setOptions(saved);

  $('#macbook-connect-btn')?.addEventListener('click', connectMacbook);
  $('#macbook-connect-btn-2')?.addEventListener('click', connectMacbook);
  $('#macbook-disconnect-btn')?.addEventListener('click', () => disconnectMacbook({ forget: true }));
  $('#macbook-closed-deg')?.addEventListener('change', persistMacbookOptions);
  $('#macbook-angle-max')?.addEventListener('change', persistMacbookOptions);

  if (saved.autoConnect) {
    setTimeout(() => connectMacbook(), 400);
  }
}

function weatherFieldsFromUi() {
  const fields = { ...DEFAULT_WEATHER_FIELDS, ...(loadConfig().weather.fields || {}) };
  $$('#weather-fields input[data-weather-field]').forEach((el) => {
    fields[el.dataset.weatherField] = !!el.checked;
  });
  return fields;
}

function persistWeatherOptions() {
  const saved = loadConfig().weather || {};
  const next = {
    ...saved,
    intervalSec: Number($('#weather-interval')?.value || 60),
    fields: weatherFieldsFromUi(),
  };
  saveConfig({ weather: next });
  weather?.setIntervalSec(next.intervalSec);
  return next;
}

function setupWeatherUi() {
  const saved = loadConfig().weather || {};
  if ($('#weather-interval')) $('#weather-interval').value = String(saved.intervalSec || 60);
  const fieldsHost = $('#weather-fields');
  if (fieldsHost) {
    const fields = { ...DEFAULT_WEATHER_FIELDS, ...(saved.fields || {}) };
    fieldsHost.innerHTML = WEATHER_FIELDS.map(
      (f) => `<label class="osc-toggle">
        <input type="checkbox" data-weather-field="${f.id}" ${fields[f.id] ? 'checked' : ''} />
        ${f.label}
      </label>`,
    ).join('');
    fieldsHost.addEventListener('change', persistWeatherOptions);
  }
  $('#weather-interval')?.addEventListener('change', persistWeatherOptions);

  weather = new WeatherSource({
    onSample: onWeatherSample,
    onStatus: onWeatherStatus,
  });

  const mapEl = $('#weather-map');
  if (mapEl) {
    weatherMap = new GeoMap(mapEl, {
      lat: Number.isFinite(saved.lat) ? saved.lat : 48,
      lon: Number.isFinite(saved.lon) ? saved.lon : 12,
      zoom: saved.zoom || 4,
      onPick: ({ lat, lon }) => pickWeatherPoint(lat, lon, ''),
    });
    if (Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
      weather.setPoint(saved.lat, saved.lon, saved.place || '');
      weatherMap.setPick(saved.lat, saved.lon, { fly: false });
      updateWeatherPlaceLabel(saved.place, saved.lat, saved.lon);
    }
  }

  $('#weather-fetch-btn')?.addEventListener('click', startWeather);
  $('#weather-stop-btn')?.addEventListener('click', stopWeather);
  $('#weather-search-btn')?.addEventListener('click', runWeatherSearch);
  $('#weather-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runWeatherSearch();
    }
  });
  $('#weather-search-results')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lat]');
    if (!btn) return;
    pickWeatherPoint(Number(btn.dataset.lat), Number(btn.dataset.lon), btn.dataset.name || '');
    $('#weather-search-results').innerHTML = '';
  });

  if (saved.autoFetch && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
    setTimeout(() => startWeather(), 400);
  }
}

function updateWeatherPlaceLabel(place, lat, lon) {
  const text =
    place ||
    (Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(3)}, ${lon.toFixed(3)}` : 'Click the map or search to set a location.');
  if ($('#weather-place')) $('#weather-place').textContent = text;
}

async function pickWeatherPoint(lat, lon, place) {
  weather?.setPoint(lat, lon, place);
  weatherMap?.setPick(lat, lon, { fly: !!place });
  const saved = loadConfig().weather || {};
  saveConfig({
    weather: {
      ...saved,
      lat,
      lon,
      place: place || saved.place || '',
      zoom: weatherMap?.zoom ?? saved.zoom,
      autoFetch: true,
    },
  });
  if (place) weather.place = place;
  updateWeatherPlaceLabel(place || weather?.place, lat, lon);
  await startWeather();
}

async function runWeatherSearch() {
  const q = $('#weather-search')?.value || '';
  const host = $('#weather-search-results');
  if (!host) return;
  try {
    const results = await searchPlaces(q);
    host.innerHTML = results.length
      ? results
          .map(
            (r) =>
              `<button type="button" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeAttr(r.name)}">${escapeHtml(r.name)}</button>`,
          )
          .join('')
      : '<p class="osc-hint">No places found</p>';
  } catch (err) {
    host.innerHTML = `<p class="osc-hint">${escapeHtml(err.message)}</p>`;
  }
}

async function startWeather() {
  persistWeatherOptions();
  const saved = loadConfig().weather;
  if (Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
    weather.setPoint(saved.lat, saved.lon, saved.place || '');
  }
  saveConfig({ weather: { autoFetch: true } });
  await weather.start();
  startWeatherSend();
  startWeatherCharts();
}

function stopWeather() {
  weather?.stop();
  saveConfig({ weather: { autoFetch: false } });
  stopWeatherSend();
}

function startWeatherSend() {
  stopWeatherSend();
  sendWeatherOsc();
  weatherSendTimer = setInterval(sendWeatherOsc, 1000);
}

function stopWeatherSend() {
  if (weatherSendTimer) {
    clearInterval(weatherSendTimer);
    weatherSendTimer = null;
  }
}

function sendWeatherOsc() {
  if (!weather?.last) return;
  const fields = weatherFieldsFromUi();
  const msgs = weatherToOsc(weather.last, fields);
  if (msgs.length) oscBridge?.sendMessages(msgs, { source: 'weather' });
}

function onWeatherStatus({ connected, running, fetching, error, place, lat, lon }) {
  $('#weather-nav-dot')?.classList.toggle('connected', !!connected);
  $('#weather-nav-dot')?.classList.toggle('connecting', !!fetching && !connected);
  $('#weather-status-dot')?.classList.toggle('connected', !!connected);
  $('#weather-status-dot')?.classList.toggle('connecting', !!fetching);
  if ($('#weather-status-text')) {
    $('#weather-status-text').textContent = fetching
      ? 'Fetching…'
      : error
        ? error
        : connected
          ? place || 'Live'
          : running
            ? 'Waiting'
            : Number.isFinite(lat)
              ? 'Ready'
              : 'Pick a point';
  }
  if ($('#weather-fetch-btn')) $('#weather-fetch-btn').disabled = !!fetching;
  if ($('#weather-stop-btn')) $('#weather-stop-btn').disabled = !running;
  if (place || (Number.isFinite(lat) && Number.isFinite(lon))) {
    updateWeatherPlaceLabel(place, lat, lon);
  }
}

function onWeatherSample(sample) {
  $('#weather-live')?.classList.remove('hidden');
  if ($('#weather-temp-value')) {
    $('#weather-temp-value').textContent = Number.isFinite(sample.temp) ? sample.temp.toFixed(1) : '—';
  }
  if ($('#weather-condition')) $('#weather-condition').textContent = sample.condition || '°C';
  if ($('#weather-place-hero')) {
    $('#weather-place-hero').textContent =
      sample.place || `${sample.lat?.toFixed?.(3) ?? '—'}, ${sample.lon?.toFixed?.(3) ?? '—'}`;
  }
  if ($('#weather-hum-value')) {
    $('#weather-hum-value').textContent = Number.isFinite(sample.humidity) ? `${Math.round(sample.humidity)}%` : '—';
  }
  if ($('#weather-wind-value')) {
    $('#weather-wind-value').textContent = Number.isFinite(sample.windSpeed)
      ? `${sample.windSpeed.toFixed(0)} km/h`
      : '—';
  }
  if ($('#weather-cloud-value')) {
    $('#weather-cloud-value').textContent = Number.isFinite(sample.clouds) ? `${Math.round(sample.clouds)}%` : '—';
  }
  if ($('#weather-precip-value')) {
    $('#weather-precip-value').textContent = Number.isFinite(sample.precip) ? `${sample.precip.toFixed(1)} mm` : '—';
  }
  if ($('#chart-weather-temp')) $('#chart-weather-temp').textContent = Number.isFinite(sample.temp)
    ? sample.temp.toFixed(1)
    : '—';
  if ($('#chart-weather-wind')) {
    $('#chart-weather-wind').textContent = Number.isFinite(sample.windSpeed) ? sample.windSpeed.toFixed(1) : '—';
  }
  const now = performance.now();
  if (Number.isFinite(sample.temp)) pushSeries(weatherOsc.temp, sample.temp, now);
  if (Number.isFinite(sample.windSpeed)) pushSeries(weatherOsc.wind, sample.windSpeed, now);
  sendWeatherOsc();
}

function startWeatherCharts() {
  stopWeatherCharts();
  drawWeatherOscCharts();
  weatherChartTimer = setInterval(drawWeatherOscCharts, 80);
}

function stopWeatherCharts() {
  if (weatherChartTimer) {
    clearInterval(weatherChartTimer);
    weatherChartTimer = null;
  }
}

function drawWeatherOscCharts() {
  const now = performance.now();
  drawOscTimeChart($('#weather-chart-temp'), weatherOsc.temp, {
    now,
    color: '#ff8c00',
    digits: 1,
  });
  drawOscTimeChart($('#weather-chart-wind'), weatherOsc.wind, {
    now,
    color: '#ffc078',
    digits: 1,
  });
}

function persistMicOptions() {
  const opts = {
    sensitivity: Number($('#mic-sensitivity')?.value || 6),
    smoothing: Number($('#mic-smoothing')?.value || 0.65),
    deviceId: $('#mic-device')?.value || loadConfig().mic.deviceId || '',
  };
  saveConfig({ mic: opts });
  mic?.setOptions(opts);
  return opts;
}

function setupMicUi() {
  const saved = loadConfig().mic || {};
  if ($('#mic-sensitivity')) $('#mic-sensitivity').value = String(saved.sensitivity ?? 6);
  if ($('#mic-smoothing')) $('#mic-smoothing').value = String(saved.smoothing ?? 0.65);

  mic = new MicSource({
    onSample: onMicSample,
    onStatus: onMicStatus,
  });
  mic.setOptions(saved);

  $('#mic-connect-btn')?.addEventListener('click', connectMic);
  $('#mic-connect-btn-2')?.addEventListener('click', connectMic);
  $('#mic-disconnect-btn')?.addEventListener('click', () => disconnectMic({ forget: true }));
  $('#mic-sensitivity')?.addEventListener('input', persistMicOptions);
  $('#mic-smoothing')?.addEventListener('input', persistMicOptions);
  $('#mic-device')?.addEventListener('change', persistMicOptions);

  refreshMicDevices(saved.deviceId);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    refreshMicDevices($('#mic-device')?.value || loadConfig().mic.deviceId);
  });

  if (saved.autoConnect) {
    setTimeout(() => connectMic(), 400);
  }
}

async function refreshMicDevices(selectedId) {
  const sel = $('#mic-device');
  if (!sel || !MicSource.isSupported()) return;
  try {
    const devices = await (mic || new MicSource()).listDevices();
    const want = selectedId || sel.value;
    sel.innerHTML = [
      '<option value="">Default input</option>',
      ...devices.map(
        (d) =>
          `<option value="${escapeAttr(d.id)}" ${d.id === want ? 'selected' : ''}>${escapeHtml(d.label)}</option>`,
      ),
    ].join('');
  } catch {
    // ignore until permission
  }
}

async function connectMic() {
  persistMicOptions();
  try {
    const info = await mic.connect($('#mic-device')?.value || '');
    saveConfig({
      mic: {
        ...persistMicOptions(),
        deviceId: info.deviceId,
        autoConnect: true,
      },
    });
    await refreshMicDevices(info.deviceId);
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError') console.error(err);
    onMicStatus({ connected: false, error: err.message });
  }
}

async function disconnectMic({ forget = false } = {}) {
  await mic?.disconnect();
  if (forget) saveConfig({ mic: { autoConnect: false } });
}

function onMicStatus({ connected, connecting, name, error }) {
  $('#mic-nav-dot')?.classList.toggle('connected', !!connected);
  $('#mic-nav-dot')?.classList.toggle('connecting', !!connecting && !connected);
  $('#mic-status-dot')?.classList.toggle('connected', !!connected);
  $('#mic-status-dot')?.classList.toggle('connecting', !!connecting);
  if ($('#mic-status-text')) {
    $('#mic-status-text').textContent = connecting
      ? 'Connecting…'
      : error
        ? error
        : connected
          ? name || 'Live'
          : 'Disconnected';
  }
  if ($('#mic-connect-btn')) $('#mic-connect-btn').disabled = !!connected || !!connecting;
  if ($('#mic-connect-btn-2')) $('#mic-connect-btn-2').disabled = !!connected || !!connecting;
  if ($('#mic-disconnect-btn')) $('#mic-disconnect-btn').disabled = !connected && !connecting;
  if ($('#mic-overlay-title')) {
    $('#mic-overlay-title').textContent = connecting ? 'Connecting…' : 'No microphone';
  }
  $('#mic-disconnected')?.classList.toggle('hidden', !!connected);
  $('#mic-live')?.classList.toggle('hidden', !connected);
  if (name && $('#mic-device-name')) $('#mic-device-name').textContent = name;
  if (connected) startMicCharts();
  else if (!connecting) {
    stopMicCharts();
    micOsc.level = [];
  }
}

function onMicSample({ level, peak, name }) {
  const lv = Number(level) || 0;
  const pk = Number(peak) || 0;
  if ($('#mic-level-value')) $('#mic-level-value').textContent = lv.toFixed(2);
  if ($('#mic-peak-value')) $('#mic-peak-value').textContent = pk.toFixed(2);
  if ($('#mic-osc-level')) $('#mic-osc-level').textContent = lv.toFixed(3);
  if ($('#chart-mic-level')) $('#chart-mic-level').textContent = lv.toFixed(3);
  if (name && $('#mic-device-name')) $('#mic-device-name').textContent = name;
  const fill = $('#mic-meter-fill');
  const peakEl = $('#mic-meter-peak');
  if (fill) fill.style.height = `${Math.round(lv * 100)}%`;
  if (peakEl) peakEl.style.bottom = `${Math.round(pk * 100)}%`;
  pushSeries(micOsc.level, lv);
  oscBridge?.sendMessages(
    [
      { address: '/mic/level', args: [Math.round(lv * 1000) / 1000] },
      { address: '/mic/peak', args: [Math.round(pk * 1000) / 1000] },
    ],
    { source: 'mic' },
  );
}

function startMicCharts() {
  stopMicCharts();
  drawMicOscCharts();
  micChartTimer = setInterval(drawMicOscCharts, 80);
}

function stopMicCharts() {
  if (micChartTimer) {
    clearInterval(micChartTimer);
    micChartTimer = null;
  }
}

function drawMicOscCharts() {
  drawOscTimeChart($('#mic-chart-level'), micOsc.level, {
    now: performance.now(),
    color: '#ff8c00',
    yMin: 0,
    yMax: 1,
    digits: 2,
  });
}

function timeFieldsFromUi() {
  const fields = { ...DEFAULT_TIME_FIELDS, ...(loadConfig().time.fields || {}) };
  $$('#time-fields input[data-time-field]').forEach((el) => {
    fields[el.dataset.timeField] = !!el.checked;
  });
  return fields;
}

function persistTimeOptions() {
  const next = {
    weekStart: Number($('#time-week-start')?.value || 1) === 0 ? 0 : 1,
    hz: 4,
    fields: timeFieldsFromUi(),
    autoStart: !!timeSource?.running,
  };
  saveConfig({ time: next });
  timeSource?.setOptions(next);
  if (!timeSource?.running) onTimeSample(timeSource.sample());
  return next;
}

function setupTimeUi() {
  const saved = loadConfig().time || {};
  if ($('#time-week-start')) $('#time-week-start').value = String(saved.weekStart === 0 ? 0 : 1);
  const host = $('#time-fields');
  if (host) {
    const fields = { ...DEFAULT_TIME_FIELDS, ...(saved.fields || {}) };
    host.innerHTML = TIME_FIELDS.map(
      (f) => `<label class="osc-toggle">
        <input type="checkbox" data-time-field="${f.id}" ${fields[f.id] ? 'checked' : ''} />
        ${f.label} 0–1
      </label>`,
    ).join('');
    host.addEventListener('change', persistTimeOptions);
  }
  $('#time-week-start')?.addEventListener('change', persistTimeOptions);

  const list = $('#time-progress-list');
  if (list) {
    list.innerHTML = TIME_FIELDS.map(
      (f) => `<div class="panel time-progress" data-time="${f.id}">
        <div class="time-progress-head">
          <h2>${f.address}</h2>
          <span class="osc-chart-value" data-time-val="${f.id}">—</span>
        </div>
        <div class="trigger-bar">
          <div class="trigger-fill" data-time-bar="${f.id}"></div>
        </div>
        <p class="osc-hint" data-time-hint="${f.id}"></p>
      </div>`,
    ).join('');
  }

  timeSource = new TimeSource({
    onSample: onTimeSample,
    onStatus: onTimeStatus,
  });
  timeSource.setOptions({ weekStart: saved.weekStart === 0 ? 0 : 1, hz: 4 });

  $('#time-start-btn')?.addEventListener('click', startTime);
  $('#time-stop-btn')?.addEventListener('click', stopTime);

  onTimeSample(timeSource.sample());
  setInterval(() => {
    if (!timeSource?.running) onTimeSample(timeSource.sample());
  }, 250);
  if (saved.autoStart) setTimeout(() => startTime(), 200);
}

function startTime() {
  persistTimeOptions();
  saveConfig({ time: { autoStart: true } });
  timeSource.start();
}

function stopTime() {
  timeSource?.stop();
  saveConfig({ time: { autoStart: false } });
}

function onTimeStatus({ connected }) {
  $('#time-nav-dot')?.classList.toggle('connected', !!connected);
  $('#time-status-dot')?.classList.toggle('connected', !!connected);
  if ($('#time-status-text')) $('#time-status-text').textContent = connected ? 'Running' : 'Stopped';
  if ($('#time-start-btn')) $('#time-start-btn').disabled = !!connected;
  if ($('#time-stop-btn')) $('#time-stop-btn').disabled = !connected;
}

function humanCountModeFromUi() {
  return $('#human-count-modes .active')?.dataset?.mode || loadConfig().human.countMode || 'off';
}

function setHumanCountMode(mode) {
  const next = mode === 'auto' || mode === 'manual' ? mode : 'off';
  $('#human-count-modes')?.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === next);
  });
}

function updateHumanCountRangeUi(observed = humanCountAuto) {
  const mode = humanCountModeFromUi();
  const range = $('#human-count-range');
  const reset = $('#human-count-reset');
  const minInput = $('#human-count-min');
  const maxInput = $('#human-count-max');
  const auto = mode === 'auto';
  range?.classList.toggle('hidden', mode === 'off');
  reset?.classList.toggle('hidden', !auto);
  if ($('#human-count-min-label')) $('#human-count-min-label').textContent = auto ? 'Detected min' : 'Min';
  if ($('#human-count-max-label')) $('#human-count-max-label').textContent = auto ? 'Detected max' : 'Max';
  if (minInput) {
    minInput.readOnly = auto;
    minInput.classList.toggle('insource-min', auto);
    if (auto) minInput.value = observed?.min != null ? String(observed.min) : '';
  }
  if (maxInput) {
    maxInput.readOnly = auto;
    maxInput.classList.toggle('insource-max', auto);
    if (auto) maxInput.value = observed?.max != null ? String(observed.max) : '';
  }
}

function persistHumanOptions() {
  const confidence = Number($('#human-confidence')?.value || 0.35);
  if ($('#human-confidence-val')) $('#human-confidence-val').textContent = confidence.toFixed(2);
  const prev = loadConfig().human || {};
  const countMode = humanCountModeFromUi();
  const countMin =
    countMode === 'manual' ? Number($('#human-count-min')?.value) : Number(prev.countMin);
  const countMax =
    countMode === 'manual' ? Number($('#human-count-max')?.value) : Number(prev.countMax);
  const opts = {
    confidence,
    deviceId: $('#human-device')?.value || prev.deviceId || '',
    countMode,
    countMin: Number.isFinite(countMin) ? countMin : 0,
    countMax: Number.isFinite(countMax) ? countMax : 8,
  };
  saveConfig({ human: opts });
  human?.setOptions(opts);
  updateHumanCountRangeUi();
  return opts;
}

function setupHumanUi() {
  const saved = loadConfig().human || {};
  if ($('#human-confidence')) $('#human-confidence').value = String(saved.confidence ?? 0.35);
  if ($('#human-confidence-val')) {
    $('#human-confidence-val').textContent = Number(saved.confidence ?? 0.35).toFixed(2);
  }
  if ($('#human-count-min')) $('#human-count-min').value = String(saved.countMin ?? 0);
  if ($('#human-count-max')) $('#human-count-max').value = String(saved.countMax ?? 8);
  setHumanCountMode(saved.countMode || 'off');
  updateHumanCountRangeUi();

  human = new HumanCountSource({
    video: $('#human-video'),
    overlay: $('#human-overlay'),
    onSample: onHumanSample,
    onStatus: onHumanStatus,
  });
  human.setOptions(saved);

  $('#human-connect-btn')?.addEventListener('click', connectHuman);
  $('#human-connect-btn-2')?.addEventListener('click', connectHuman);
  $('#human-disconnect-btn')?.addEventListener('click', () => disconnectHuman({ forget: true }));
  $('#human-confidence')?.addEventListener('input', persistHumanOptions);
  $('#human-device')?.addEventListener('change', persistHumanOptions);
  $('#human-count-modes')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    const prev = loadConfig().human || {};
    setHumanCountMode(btn.dataset.mode);
    if (btn.dataset.mode === 'manual') {
      if ($('#human-count-min')) $('#human-count-min').value = String(prev.countMin ?? 0);
      if ($('#human-count-max')) $('#human-count-max').value = String(prev.countMax ?? 8);
    }
    persistHumanOptions();
  });
  $('#human-count-min')?.addEventListener('change', persistHumanOptions);
  $('#human-count-max')?.addEventListener('change', persistHumanOptions);
  $('#human-count-reset')?.addEventListener('click', () => {
    humanCountAuto = null;
    updateHumanCountRangeUi();
  });

  refreshHumanDevices(saved.deviceId);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    refreshHumanDevices($('#human-device')?.value || loadConfig().human.deviceId);
  });

  if (saved.autoConnect) setTimeout(() => connectHuman(), 500);
}

async function refreshHumanDevices(selectedId) {
  const sel = $('#human-device');
  if (!sel || !HumanCountSource.isSupported()) return;
  try {
    const devices = await (human || new HumanCountSource()).listDevices();
    const want = selectedId || sel.value;
    sel.innerHTML = [
      '<option value="">Default camera</option>',
      ...devices.map(
        (d) =>
          `<option value="${escapeAttr(d.id)}" ${d.id === want ? 'selected' : ''}>${escapeHtml(d.label)}</option>`,
      ),
    ].join('');
  } catch {
    // ignore until permission
  }
}

async function connectHuman() {
  persistHumanOptions();
  try {
    const info = await human.connect($('#human-device')?.value || '');
    saveConfig({
      human: {
        ...persistHumanOptions(),
        deviceId: info.deviceId,
        autoConnect: true,
      },
    });
    await refreshHumanDevices(info.deviceId);
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError') console.error(err);
    onHumanStatus({ connected: false, error: err.message });
  }
}

async function disconnectHuman({ forget = false } = {}) {
  await human?.disconnect();
  if (forget) saveConfig({ human: { autoConnect: false } });
}

function onHumanStatus({ connected, connecting, name, error, message, preview }) {
  $('#human-nav-dot')?.classList.toggle('connected', !!connected);
  $('#human-nav-dot')?.classList.toggle('connecting', !!connecting && !connected);
  $('#human-status-dot')?.classList.toggle('connected', !!connected);
  $('#human-status-dot')?.classList.toggle('connecting', !!connecting);
  if ($('#human-status-text')) {
    $('#human-status-text').textContent = connecting
      ? message || 'Connecting…'
      : error
        ? error
        : connected
          ? name || 'Live'
          : 'Disconnected';
  }
  if ($('#human-connect-btn')) $('#human-connect-btn').disabled = !!connected || !!connecting;
  if ($('#human-connect-btn-2')) $('#human-connect-btn-2').disabled = !!connected || !!connecting;
  if ($('#human-disconnect-btn')) $('#human-disconnect-btn').disabled = !connected && !connecting;
  if ($('#human-overlay-title')) {
    $('#human-overlay-title').textContent = connecting ? message || 'Connecting…' : 'No camera';
  }
  const showPreview = !!connected || !!preview || !!connecting;
  $('#human-disconnected')?.classList.toggle('hidden', showPreview);
  $('#human-live')?.classList.toggle('hidden', !showPreview);
  if (name && $('#human-device-name')) $('#human-device-name').textContent = name;
  if (preview) setActiveSection('human');
}

function onHumanSample({ count, present, name }) {
  const raw = Number(count) || 0;
  const opts = loadConfig().human || {};
  if (opts.countMode === 'auto') {
    humanCountAuto = observeRange(humanCountAuto, raw);
    updateHumanCountRangeUi(humanCountAuto);
  }
  const oscCount = countToOsc(raw, opts, humanCountAuto);
  if ($('#human-count-value')) $('#human-count-value').textContent = String(raw);
  if (name && $('#human-device-name')) $('#human-device-name').textContent = name;
  if ($('#human-osc-hint')) {
    const shown = opts.countMode === 'off' ? String(raw) : oscCount.toFixed(3);
    $('#human-osc-hint').innerHTML = `<code>/human/count</code> ${shown}`;
  }
  oscBridge?.sendMessages(
    [
      { address: '/human/count', args: [oscCount] },
      { address: '/human/present', args: [present ? 1 : 0] },
    ],
    { source: 'human' },
  );
}

function onTimeSample(sample) {
  if (!sample) return;
  const clock = sample.clock;
  if ($('#time-clock') && clock) {
    $('#time-clock').textContent = clock.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  if ($('#time-clock-date') && clock) {
    $('#time-clock-date').textContent = clock.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  for (const f of TIME_FIELDS) {
    const v = sample[f.id];
    const valEl = document.querySelector(`[data-time-val="${f.id}"]`);
    const bar = document.querySelector(`[data-time-bar="${f.id}"]`);
    const hint = document.querySelector(`[data-time-hint="${f.id}"]`);
    if (valEl && Number.isFinite(v)) valEl.textContent = v.toFixed(4);
    if (bar && Number.isFinite(v)) bar.style.width = `${(v * 100).toFixed(3)}%`;
    if (hint && Number.isFinite(v)) hint.textContent = `${(v * 100).toFixed(2)}% of ${f.label.toLowerCase()}`;
  }
  if (timeSource?.running) {
    const msgs = timeToOsc(sample, timeFieldsFromUi());
    if (msgs.length) oscBridge?.sendMessages(msgs, { source: 'time' });
  }
}

async function connectGarmin() {
  await ensureAudioClock();
  try {
    const device = await garmin.connect();
    saveConfig({
      garmin: {
        ...garminOptionsFromUi(),
        deviceId: device.id,
        autoConnect: true,
      },
    });
  } catch (err) {
    if (err?.name !== 'NotFoundError') console.error(err);
  }
}

async function disconnectGarmin({ forget = false } = {}) {
  await garmin?.disconnect();
  if (forget) {
    saveConfig({ garmin: { autoConnect: false, deviceId: '' } });
  }
}

async function connectMacbook() {
  persistMacbookOptions();
  if (macbook) macbook._want = true;
  onMacbookStatus({ connecting: true, connected: false });

  ensureGatewayConnection();
  const open = await oscBridge.waitUntilOpen(1800);
  if (open) {
    const nativeOk = await requestNativeLid();
    if (nativeOk) {
      saveConfig({ macbook: { ...macbookOptionsFromUi(), autoConnect: true } });
      return;
    }
  }

  await ensureAudioClock();
  try {
    const ok = await macbook.connect();
    saveConfig({ macbook: { ...macbookOptionsFromUi(), autoConnect: !!ok } });
    syncAudioTicks();
  } catch (err) {
    if (err?.name !== 'NotFoundError' && err?.name !== 'NotAllowedError') console.error(err);
  }
}

function requestNativeLid() {
  return new Promise((resolve) => {
    macbookNativeWait = resolve;
    const sent = oscBridge?.send({ type: 'macbook', enabled: true, ...macbookOptionsFromUi() });
    if (!sent) {
      macbookNativeWait = null;
      resolve(false);
      return;
    }
    setTimeout(() => {
      if (macbookNativeWait === resolve) {
        macbookNativeWait = null;
        resolve(!!macbookUsingNative);
      }
    }, 1200);
  });
}

async function disconnectMacbook({ forget = false } = {}) {
  if (macbookUsingNative) {
    oscBridge?.send({ type: 'macbook', enabled: false });
    macbookUsingNative = false;
  }
  await macbook?.disconnect();
  syncAudioTicks();
  if (forget) saveConfig({ macbook: { autoConnect: false } });
}

function onMacbookStatus({ connected, connecting, sources, error }) {
  const text = connecting
    ? 'Connecting…'
    : connected
      ? (sources?.filter(Boolean).join(' · ') || 'Connected')
      : 'Disconnected';
  if ($('#macbook-status-text')) $('#macbook-status-text').textContent = text;
  $('#macbook-status-dot')?.classList.toggle('connected', !!connected);
  $('#macbook-status-dot')?.classList.toggle('connecting', !!connecting && !connected);
  $('#macbook-nav-dot')?.classList.toggle('connected', !!connected);
  $('#macbook-nav-dot')?.classList.toggle('connecting', !!connecting && !connected);

  if ($('#macbook-connect-btn')) $('#macbook-connect-btn').disabled = !!connected || !!connecting;
  if ($('#macbook-disconnect-btn')) $('#macbook-disconnect-btn').disabled = !macbook?._want && !connected;
  if ($('#macbook-connect-btn-2')) $('#macbook-connect-btn-2').disabled = !!connected || !!connecting;

  if ($('#macbook-error')) $('#macbook-error').textContent = error || '';
  if ($('#macbook-overlay-title')) {
    $('#macbook-overlay-title').textContent = connecting ? 'Connecting…' : 'No MacBook sensors';
  }

  $('#macbook-disconnected')?.classList.toggle('hidden', !!connected);
  $('#macbook-live')?.classList.toggle('hidden', !connected);
  if ($('#macbook-device-name') && sources?.length) {
    $('#macbook-device-name').textContent = sources.join(' · ');
  }

  syncAudioTicks();
  if (connected) startMacbookCharts();
  else if (!connecting) {
    stopMacbookCharts();
    macbookOsc.angle = [];
    macbookOsc.open = [];
  }
}

function onMacbookSample(sample) {
  const now = sample.t || performance.now();
  if (sample.lidAngle != null) {
    if ($('#macbook-angle-value')) $('#macbook-angle-value').textContent = `${sample.lidAngle.toFixed(1)}°`;
    if ($('#chart-mac-angle-value')) $('#chart-mac-angle-value').textContent = sample.lidAngle.toFixed(1);
    const lid = $('#mac-lid-graphic');
    if (lid) lid.style.transform = `rotate(${-Math.min(180, sample.lidAngle)}deg)`;
    pushSeries(macbookOsc.angle, sample.lidAngle, now);
  }
  if (sample.lidOpen != null) {
    if ($('#macbook-open-value')) $('#macbook-open-value').textContent = sample.lidOpen ? 'open' : 'closed';
    if ($('#chart-mac-open-value')) $('#chart-mac-open-value').textContent = String(sample.lidOpen);
    pushSeries(macbookOsc.open, sample.lidOpen, now);
  }
  if (sample.lidNorm != null && $('#macbook-norm-value')) {
    $('#macbook-norm-value').textContent = sample.lidNorm.toFixed(3);
  }
  if (sample.als != null && $('#macbook-als-value')) {
    $('#macbook-als-value').textContent = String(Math.round(sample.als));
  }

  const hasImu = !!(sample.accel || sample.gyro);
  $('#macbook-imu-panel')?.classList.toggle('hidden', !hasImu);
  if (sample.accel) {
    const mag = Math.hypot(sample.accel.x, sample.accel.y, sample.accel.z);
    if ($('#macbook-accel-mag')) $('#macbook-accel-mag').textContent = mag.toFixed(3);
    if ($('#mac-accel-x')) $('#mac-accel-x').textContent = sample.accel.x.toFixed(3);
    if ($('#mac-accel-y')) $('#mac-accel-y').textContent = sample.accel.y.toFixed(3);
    if ($('#mac-accel-z')) $('#mac-accel-z').textContent = sample.accel.z.toFixed(3);
  }
  if (sample.gyro) {
    if ($('#mac-gyro-x')) $('#mac-gyro-x').textContent = sample.gyro.x.toFixed(2);
    if ($('#mac-gyro-y')) $('#mac-gyro-y').textContent = sample.gyro.y.toFixed(2);
    if ($('#mac-gyro-z')) $('#mac-gyro-z').textContent = sample.gyro.z.toFixed(2);
  }

  const messages = [];
  if (sample.lidAngle != null) messages.push({ address: '/mac/lid/angle', args: [sample.lidAngle] });
  if (sample.lidOpen != null) messages.push({ address: '/mac/lid/open', args: [sample.lidOpen] });
  if (sample.lidNorm != null) messages.push({ address: '/mac/lid/norm', args: [sample.lidNorm] });
  if (sample.accel) {
    messages.push(
      { address: '/mac/accel/x', args: [sample.accel.x] },
      { address: '/mac/accel/y', args: [sample.accel.y] },
      { address: '/mac/accel/z', args: [sample.accel.z] },
    );
  }
  if (sample.gyro) {
    messages.push(
      { address: '/mac/gyro/x', args: [sample.gyro.x] },
      { address: '/mac/gyro/y', args: [sample.gyro.y] },
      { address: '/mac/gyro/z', args: [sample.gyro.z] },
    );
  }
  if (sample.als != null) messages.push({ address: '/mac/als', args: [sample.als] });
  if (messages.length) oscBridge?.sendMessages(messages, { source: 'macbook' });
}

function onAudioTick() {
  onGarminTrendTick();
  macbook?.poll();
}

function onGarminStatus({ connected, connecting, reconnecting, name }) {
  const text = reconnecting
    ? 'Reconnecting…'
    : connecting
      ? 'Connecting…'
      : connected
        ? (name || 'Connected')
        : 'Disconnected';
  if ($('#garmin-status-text')) $('#garmin-status-text').textContent = text;
  $('#garmin-status-dot')?.classList.toggle('connected', !!connected);
  $('#garmin-status-dot')?.classList.toggle('connecting', !!(connecting || reconnecting) && !connected);
  $('#garmin-nav-dot')?.classList.toggle('connected', !!connected);
  $('#garmin-nav-dot')?.classList.toggle('connecting', !!(connecting || reconnecting) && !connected);

  $('#garmin-connect-btn').disabled = !!connected || !!connecting;
  $('#garmin-disconnect-btn').disabled = !garmin?._wantConnect;
  if ($('#garmin-connect-btn-2')) $('#garmin-connect-btn-2').disabled = !!connected || !!connecting;

  if ($('#garmin-overlay-title')) {
    $('#garmin-overlay-title').textContent = reconnecting
      ? 'Reconnecting to Garmin…'
      : 'No heart rate broadcast';
  }

  $('#garmin-disconnected')?.classList.toggle('hidden', !!connected);
  $('#garmin-live')?.classList.toggle('hidden', !connected);
  if ($('#garmin-device-name') && name) $('#garmin-device-name').textContent = name;
  syncGarminTrendTick();
  if (connected) {
    startGarminCharts();
  } else if (!reconnecting) {
    stopGarminCharts();
    garminOsc.hr = [];
    garminOsc.trend = [];
    garminOsc.beat = [];
    garminBeatsSent = 0;
    if ($('#garmin-hr-value')) $('#garmin-hr-value').textContent = '—';
    if ($('#chart-hr-value')) $('#chart-hr-value').textContent = '—';
    if ($('#chart-trend-value')) $('#chart-trend-value').textContent = '—';
    if ($('#chart-beat-value')) $('#chart-beat-value').textContent = '0';
  }
}

function onGarminSample({ hr, trendDelta, name }) {
  const opts = garminOptionsFromUi();
  const hrOsc = hrToOsc(hr, opts);
  const trendOsc = opts.trendSmooth
    ? garmin.stepTrend(opts.trendRangeBpm)
    : trendToOsc(trendDelta, opts.trendRangeBpm);
  const now = performance.now();

  if ($('#garmin-hr-value')) $('#garmin-hr-value').textContent = String(Math.round(hr));
  if ($('#garmin-device-name') && name) $('#garmin-device-name').textContent = name;
  updateGarminTrendUi(trendOsc, trendDelta);

  if ($('#garmin-osc-hr')) {
    $('#garmin-osc-hr').textContent = opts.normalizeHr ? hrOsc.toFixed(3) : String(Math.round(hr));
  }
  if ($('#chart-hr-value')) {
    $('#chart-hr-value').textContent = opts.normalizeHr ? hrOsc.toFixed(3) : hrOsc.toFixed(1);
  }

  pushGarminOsc('hr', hrOsc, now);
  if (!opts.trendSmooth) pushGarminOsc('trend', trendOsc, now);

  const messages = [{ address: '/garmin/hr', args: [hrOsc] }];
  if (!opts.trendSmooth) messages.push({ address: '/garmin/trend', args: [trendOsc] });
  oscBridge?.sendMessages(messages, { source: 'garmin' });
}

function onGarminTrendTick() {
  if (!garmin?.connected || !garmin.trendSmooth) return;
  const opts = garminOptionsFromUi();
  const trendOsc = garmin.stepTrend(opts.trendRangeBpm);
  const trendDelta = garmin.getTrendDelta();
  const now = performance.now();
  updateGarminTrendUi(trendOsc, trendDelta);
  pushGarminOsc('trend', trendOsc, now);
  oscBridge?.sendMessages([{ address: '/garmin/trend', args: [trendOsc] }], { source: 'garmin' });
}

function updateGarminTrendUi(trendOsc, trendDelta) {
  if ($('#garmin-trend-value')) $('#garmin-trend-value').textContent = trendOsc.toFixed(3);
  if ($('#garmin-trend-delta')) {
    const sign = trendDelta > 0 ? '+' : '';
    $('#garmin-trend-delta').textContent = `${sign}${Number(trendDelta).toFixed(1)}`;
  }
  if ($('#chart-trend-value')) $('#chart-trend-value').textContent = trendOsc.toFixed(3);
}

function onGarminBeat(value = 1) {
  if (value === 0) {
    pushGarminOsc('beat', 0);
    oscBridge?.sendTrigger('/garmin/push_beat', 0, { source: 'garmin' });
    if ($('#chart-beat-value')) $('#chart-beat-value').textContent = '0';
    return;
  }

  garminBeatsSent++;
  if ($('#garmin-beats')) $('#garmin-beats').textContent = String(garminBeatsSent);
  if ($('#chart-beat-value')) $('#chart-beat-value').textContent = '1';

  const pulse = $('#garmin-beat-pulse');
  if (pulse) {
    pulse.classList.remove('pulse');
    void pulse.offsetWidth;
    pulse.classList.add('pulse');
    clearTimeout(garminBeatPulseTimer);
    garminBeatPulseTimer = setTimeout(() => pulse.classList.remove('pulse'), 400);
  }

  if (!$('#garmin-send-beats')?.checked) return;
  pushGarminOsc('beat', 1);
  oscBridge?.sendTrigger('/garmin/push_beat', 1, { source: 'garmin' });
}

async function ensureAudioClock() {
  if (!audioClock) {
    audioClock = new AudioClock({
      onPulse: (v) => onGarminBeat(v),
      onTick: onAudioTick,
    });
  }
  try {
    await audioClock.start();
    garmin?.setAudioClock(audioClock);
    audioClock.resume();
    syncAudioTicks();
  } catch (err) {
    console.warn('Audio clock unavailable; background beats may throttle', err);
  }
  return audioClock;
}

function pushGarminOsc(key, value, t = performance.now()) {
  garminOsc[key].push({ t, v: Number(value) });
  const cutoff = t - GARMIN_CHART_WINDOW_MS - 1000;
  const series = garminOsc[key];
  while (series.length > 1 && series[1].t < cutoff) series.shift();
}

function pushSeries(series, value, t = performance.now()) {
  series.push({ t, v: Number(value) });
  const cutoff = t - GARMIN_CHART_WINDOW_MS - 1000;
  while (series.length > 1 && series[1].t < cutoff) series.shift();
}

function startMacbookCharts() {
  stopMacbookCharts();
  drawMacbookOscCharts();
  macbookChartTimer = setInterval(drawMacbookOscCharts, 80);
}

function stopMacbookCharts() {
  if (macbookChartTimer) {
    clearInterval(macbookChartTimer);
    macbookChartTimer = null;
  }
}

function startInSourceCharts() {
  stopInSourceCharts();
  drawInSourceCharts();
  inChartTimer = setInterval(drawInSourceCharts, 80);
}

function stopInSourceCharts() {
  if (inChartTimer) {
    clearInterval(inChartTimer);
    inChartTimer = null;
  }
}

function drawInSourceCharts() {
  const id = currentInSourceId();
  if (!id) return;
  const liveMap = inLive.get(id) || new Map();
  const src = (loadConfig().osc.inSources || []).find((s) => s.id === id);
  $('#insource-endpoints')
    ?.querySelectorAll('.insource-ep.open canvas.insource-ep-chart')
    .forEach((canvas) => {
      const address = canvas.dataset.epChart;
      const slot = liveMap.get(address);
      const spec = src?.endpoints?.[address];
      const series = slot?.series || [];
      drawOscTimeChart(
        canvas,
        series.map((s) => ({ t: s.t, v: s.raw })),
        {
          now: performance.now(),
          color: '#ff8c00',
          minSpan: 0,
          digits: 2,
          overlay:
            spec && spec.mode !== 'off'
              ? series
                  .filter((s) => Number.isFinite(s.out))
                  .map((s) => ({ t: s.t, v: s.out }))
              : null,
          overlayColor: '#ffd200',
        },
      );
    });
}

function drawMacbookOscCharts() {
  const now = performance.now();
  drawOscTimeChart($('#macbook-chart-angle'), macbookOsc.angle, {
    now,
    color: '#ff8c00',
    yMin: 0,
    yMax: Number($('#macbook-angle-max')?.value || 180),
    digits: 0,
  });
  drawOscTimeChart($('#macbook-chart-open'), macbookOsc.open, {
    now,
    color: '#ffd200',
    yMin: 0,
    yMax: 1,
    digits: 0,
  });
}

function startGarminCharts() {
  stopGarminCharts();
  drawGarminOscCharts();
  garminChartTimer = setInterval(drawGarminOscCharts, 80);
}

function stopGarminCharts() {
  if (garminChartTimer) {
    clearInterval(garminChartTimer);
    garminChartTimer = null;
  }
}

function drawGarminOscCharts() {
  const now = performance.now();
  const opts = garminOptionsFromUi();
  drawOscTimeChart($('#garmin-chart-hr'), garminOsc.hr, {
    now,
    color: '#ff8c00',
    yMin: opts.normalizeHr ? 0 : null,
    yMax: opts.normalizeHr ? 1 : null,
    mid: opts.normalizeHr ? 0.5 : null,
    digits: opts.normalizeHr ? 2 : 0,
  });
  drawOscTimeChart($('#garmin-chart-trend'), garminOsc.trend, {
    now,
    color: '#ffc078',
    yMin: 0,
    yMax: 1,
    mid: 0.5,
    digits: 2,
  });
  drawOscTimeChart($('#garmin-chart-beat'), garminOsc.beat, {
    now,
    color: '#ffd200',
    yMin: 0,
    yMax: 1,
    impulses: true,
    digits: 0,
  });
}

function drawOscTimeChart(canvas, samples, {
  now,
  color,
  yMin = null,
  yMax = null,
  mid = null,
  impulses = false,
  digits = 2,
  minSpan = 8,
  overlay = null,
  overlayColor = '#ffd200',
} = {}) {
  if (!canvas || canvas.clientWidth < 8) return;
  const dpr = devicePixelRatio || 1;
  const w = (canvas.width = canvas.clientWidth * dpr);
  const h = (canvas.height = canvas.clientHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const windowMs = GARMIN_CHART_WINDOW_MS;
  const t0 = now - windowMs;
  const padT = 6 * dpr;
  const padB = 6 * dpr;
  const padL = 36 * dpr;
  const padR = (overlay?.length ? 28 : 8) * dpr;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);

  const xAt = (t) => padL + ((t - t0) / windowMs) * plotW;
  const yAt = (v, min, max) => padT + (1 - (v - min) / (max - min || 1)) * plotH;

  ctx.strokeStyle = '#272727';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, h - padB);
  ctx.lineTo(w - padR, h - padB);
  ctx.stroke();

  const inWindow = samples.filter((s) => s.t >= t0 - 2000);
  if (!inWindow.length) {
    drawChartLabels(ctx, dpr, padL, padT, h - padB, yMin ?? 0, yMax ?? 1, digits);
    return;
  }

  let min = yMin;
  let max = yMax;
  if (min == null || max == null) {
    const vals = inWindow.map((s) => s.v).filter((v) => Number.isFinite(v));
    min = vals.length ? Math.min(...vals) : 0;
    max = vals.length ? Math.max(...vals) : 1;
    if (minSpan > 0 && max - min < minSpan) {
      const midVal = (min + max) / 2;
      min = midVal - minSpan / 2;
      max = midVal + minSpan / 2;
    }
    const pad = (max - min) * 0.12 || 1;
    min -= pad;
    max += pad;
  }

  if (mid != null) {
    ctx.strokeStyle = 'rgba(255, 140, 0, 0.28)';
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    const y = yAt(mid, min, max);
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (impulses) {
    const minBar = Math.max(3 * dpr, plotW * 0.006);
    ctx.fillStyle = color;
    for (const s of inWindow) {
      if (s.v <= 0 || s.t < t0 || s.t > now) continue;
      const x = xAt(s.t);
      const y1 = yAt(1, min, max);
      const y0 = yAt(0, min, max);
      ctx.fillRect(x - minBar / 2, y1, minBar, y0 - y1);
    }
    drawChartLabels(ctx, dpr, padL, padT, h - padB, min, max, digits);
    return;
  }

  const points = [];
  const first = inWindow[0];
  points.push({ t: Math.max(t0, first.t), v: first.v });
  for (let i = 1; i < inWindow.length; i++) {
    const s = inWindow[i];
    if (s.t < t0) continue;
    points.push({ t: s.t, v: inWindow[i - 1].v });
    points.push({ t: s.t, v: s.v });
  }
  const last = inWindow[inWindow.length - 1];
  points.push({ t: now, v: last.v });

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dpr;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(p.t);
    const y = yAt(p.v, min, max);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.globalAlpha = 0.12;
  ctx.lineTo(xAt(now), yAt(min, min, max));
  ctx.lineTo(xAt(points[0].t), yAt(min, min, max));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  if (overlay?.length) {
    const oWin = overlay.filter((s) => s.t >= t0 - 2000 && Number.isFinite(s.v));
    if (oWin.length) {
      const oPoints = [];
      oPoints.push({ t: Math.max(t0, oWin[0].t), v: oWin[0].v });
      for (let i = 1; i < oWin.length; i++) {
        oPoints.push({ t: oWin[i].t, v: oWin[i - 1].v });
        oPoints.push({ t: oWin[i].t, v: oWin[i].v });
      }
      oPoints.push({ t: now, v: oWin[oWin.length - 1].v });
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, plotH);
      ctx.clip();
      ctx.strokeStyle = overlayColor;
      ctx.lineWidth = 1.75 * dpr;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      oPoints.forEach((p, i) => {
        const x = xAt(p.t);
        const y = yAt(p.v, 0, 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = overlayColor;
    ctx.font = `${11 * dpr}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('1', w - 4 * dpr, padT);
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', w - 4 * dpr, h - padB);
    ctx.textAlign = 'left';
  }

  drawChartLabels(ctx, dpr, padL, padT, h - padB, min, max, digits);
}

function drawChartLabels(ctx, dpr, x, yTop, yBot, min, max, digits) {
  ctx.fillStyle = '#8f8f8f';
  ctx.font = `${11 * dpr}px 'JetBrains Mono', monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(formatChartTick(max, digits), 4 * dpr, yTop);
  ctx.textBaseline = 'bottom';
  ctx.fillText(formatChartTick(min, digits), 4 * dpr, yBot);
}

function formatChartTick(v, digits) {
  if (!Number.isFinite(v)) return '—';
  return digits <= 0 ? String(Math.round(v)) : v.toFixed(digits);
}

function syncOutputUiFromController() {
  if (!controller) return;
  const { lightbar, muteLed, motorLeft, motorRight, playerLeds } = controller.output;
  const hex =
    '#' +
    [lightbar.r, lightbar.g, lightbar.b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  $('#lightbar-color').value = hex;
  $('#color-preview').style.background = hex;
  $('#mute-led').checked = muteLed;
  $('#rumble-left-slider').value = motorLeft;
  $('#rumble-right-slider').value = motorRight;
  $$('.led-btn').forEach((btn) => {
    const bit = 1 << (parseInt(btn.dataset.led, 10) - 1);
    btn.classList.toggle('active', !!(playerLeds & bit));
  });
}

function setupOutputControls() {
  const colorPicker = $('#lightbar-color');
  const preview = $('#color-preview');

  const updateLightbar = () => {
    if (!controller) return;
    const hex = colorPicker.value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    preview.style.background = hex;
    controller.setLightbar(r, g, b);
  };

  colorPicker.addEventListener('input', updateLightbar);
  preview.style.background = colorPicker.value;

  $('#mute-led').addEventListener('change', (e) => {
    controller?.setMuteLed(e.target.checked);
  });

  $$('.led-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!controller) return;
      btn.classList.toggle('active');
      let mask = 0;
      $$('.led-btn.active').forEach((b) => {
        mask |= 1 << (parseInt(b.dataset.led, 10) - 1);
      });
      controller.setPlayerLeds(mask);
    });
  });

  $$('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!controller) return;
      const side = btn.dataset.side;
      const preset = btn.dataset.preset;
      $$(`[data-side="${side}"][data-preset]`).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      controller.setTriggerEffect(side, preset);
    });
  });

  $('#rumble-left').addEventListener('click', () => pulseRumble('left'));
  $('#rumble-right').addEventListener('click', () => pulseRumble('right'));
  $('#rumble-both').addEventListener('click', () => pulseRumble('both'));
  $('#rumble-stop').addEventListener('click', () => controller?.setRumble(0, 0));

  $('#rumble-left-slider').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    const r = parseInt($('#rumble-right-slider').value, 10);
    controller?.setRumble(v, r);
  });
  $('#rumble-right-slider').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    const l = parseInt($('#rumble-left-slider').value, 10);
    controller?.setRumble(l, v);
  });
}

async function pulseRumble(side) {
  if (!controller) return;
  const intensity = 200;
  if (side === 'left' || side === 'both') controller.setRumble(intensity, controller.output.motorRight);
  if (side === 'right' || side === 'both') controller.setRumble(controller.output.motorLeft, intensity);
  if (side === 'both') controller.setRumble(intensity, intensity);
  setTimeout(() => controller?.setRumble(0, 0), 500);
}

function setupFeatureReports() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const id = tab.dataset.tab;
      $('#tab-output').classList.toggle('hidden', id !== 'output');
      $('#tab-osc')?.classList.toggle('hidden', id !== 'osc');
      $('#tab-debug').classList.toggle('hidden', id !== 'debug');
    });
  });

  $('#read-feature-20').addEventListener('click', () => readFeature(0x20, 'Firmware'));
  $('#read-feature-22').addEventListener('click', () => readFeature(0x22, 'Hardware'));
  $('#read-feature-05').addEventListener('click', () => readFeature(0x05, 'Calibration'));
}

async function readFeature(id, label) {
  if (!controller) return;
  try {
    const data = await controller.readFeatureReport(id);
    const bytes = new Uint8Array(data.buffer);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    $('#feature-result').textContent = `${label} (0x${id.toString(16)}):\n${hex}`;
  } catch (err) {
    $('#feature-result').textContent = `Error reading 0x${id.toString(16)}: ${err.message}`;
  }
}

async function connect() {
  try {
    const devices = await navigator.hid.requestDevice({ filters: DualSenseDevice.filters() });
    const device = devices[0];
    if (!device) return;
    await openDevice(device);
  } catch (err) {
    console.error(err);
  }
}

async function checkExistingDevices() {
  if (!navigator.hid) return;
  const devices = await navigator.hid.getDevices();
  if (!controller) {
    const ds = devices.find((d) => DualSenseDevice.isDualSense(d));
    if (ds) await openDevice(ds);
  }
}

async function openDevice(hidDevice) {
  if (controller) await controller.close();

  controller = new DualSenseDevice(hidDevice);
  controller.onInput = onInput;
  controller.onDisconnect = () => disconnect();

  try {
    await controller.open();
  } catch (err) {
    console.error('Failed to open device', err);
    controller = null;
    return;
  }

  updateConnectionUI(true);
  $('#disconnected-view').classList.add('hidden');
  $('#main-content').classList.remove('hidden');

  $('#device-name').textContent = hidDevice.productName;
  $('#device-vidpid').textContent = `0x${hidDevice.vendorId.toString(16).padStart(4, '0')}:0x${hidDevice.productId.toString(16).padStart(4, '0')}`;
  $('#device-connection').textContent = controller.connectionType.toUpperCase();

  controller.setLightbar(0, 80, 255);
  controller.setPlayerLeds(0x0a);
}

async function disconnect() {
  if (controller) {
    controller.setRumble(0, 0);
    controller.setTriggerEffect('l2', 'off');
    controller.setTriggerEffect('r2', 'off');
    await controller.close();
    controller = null;
  }
  updateConnectionUI(false);
  $('#disconnected-view').classList.remove('hidden');
  $('#main-content').classList.add('hidden');
}

function onHidDisconnect(e) {
  if (controller && e.device === controller.device) {
    disconnect();
  }
  macbook?.handleHidDisconnect(e.device);
}

function updateConnectionUI(connected) {
  $('#connect-btn').disabled = connected;
  $('#disconnect-btn').disabled = !connected;
  if ($('#connect-btn-2')) $('#connect-btn-2').disabled = connected;
  const dot = $('#status-dot');
  dot.classList.toggle('connected', connected);
  $('#controller-nav-dot')?.classList.toggle('connected', connected);
  $('#status-text').textContent = connected ? 'Connected' : 'Disconnected';
}

function onInput(state, event) {
  reportCount++;
  const now = performance.now();
  const dt = now - lastReportTime;
  if (dt >= 1000) {
    hz = Math.round((reportCount * 1000) / dt);
    reportCount = 0;
    lastReportTime = now;
    $('#report-rate').textContent = hz;
  }

  updateButtons(state.buttons);
  updateTriggers(state.triggers);
  updateSticks(state.sticks);
  updateTouchpad(state.touch);
  updateMotion(state);
  updateBattery(state.battery);
  updateAdaptiveTriggers(state.adaptiveTriggers);

  oscBridge?.sendState(state);

  if (event) {
    const hex = formatHex(event.reportId, event.data);
    $('#raw-hex').value = hex;
  }

  $('#report-id').textContent = `0x${state.reportId.toString(16).padStart(2, '0')}`;
}

function formatHex(reportId, data) {
  const parts = [reportId.toString(16).padStart(2, '0')];
  for (let i = 0; i < data.byteLength; i++) {
    parts.push(data.getUint8(i).toString(16).padStart(2, '0'));
  }
  return parts.join(' ');
}

function updateButtons(buttons) {
  if (!buttons) return;
  const map = {
    cross: buttons.cross,
    circle: buttons.circle,
    square: buttons.square,
    triangle: buttons.triangle,
    l1: buttons.l1,
    r1: buttons.r1,
    l2: buttons.l2,
    r2: buttons.r2,
    l3: buttons.l3,
    r3: buttons.r3,
    create: buttons.create,
    options: buttons.options,
    ps: buttons.ps,
    touchpad: buttons.touchpad,
    mute: buttons.mute,
    'dpad-up': buttons.dpad.up,
    'dpad-down': buttons.dpad.down,
    'dpad-left': buttons.dpad.left,
    'dpad-right': buttons.dpad.right,
  };
  for (const [id, active] of Object.entries(map)) {
    const el = document.getElementById(`btn-${id}`);
    if (el) el.classList.toggle('active', !!active);
  }
}

function updateTriggers(triggers) {
  if (!triggers) return;
  const l2Pct = Math.round(normalizeTrigger(triggers.l2) * 100);
  const r2Pct = Math.round(normalizeTrigger(triggers.r2) * 100);
  $('#trigger-l2-fill').style.width = `${l2Pct}%`;
  $('#trigger-r2-fill').style.width = `${r2Pct}%`;
  $('#trigger-l2-value').textContent = `${l2Pct}% (${triggers.l2})`;
  $('#trigger-r2-value').textContent = `${r2Pct}% (${triggers.r2})`;
}

function updateSticks(sticks) {
  if (!sticks) return;
  const lx = normalizeStick(sticks.left.x);
  const ly = normalizeStick(sticks.left.y);
  const rx = normalizeStick(sticks.right.x);
  const ry = normalizeStick(sticks.right.y);

  drawStick(stickCanvases.left.ctx, stickCanvases.left.canvas, lx, ly);
  drawStick(stickCanvases.right.ctx, stickCanvases.right.canvas, rx, ry);

  $('#stick-lx').textContent = lx.toFixed(3);
  $('#stick-ly').textContent = ly.toFixed(3);
  $('#stick-rx').textContent = rx.toFixed(3);
  $('#stick-ry').textContent = ry.toFixed(3);
}

function drawStick(ctx, canvas, x, y) {
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.42;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#272727';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  const px = cx + x * radius * 0.85;
  const py = cy + y * radius * 0.85;

  ctx.fillStyle = 'rgba(255, 140, 0, 0.25)';
  ctx.beginPath();
  ctx.arc(px, py, radius * 0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff8c00';
  ctx.beginPath();
  ctx.arc(px, py, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function updateTouchpad(touches) {
  const canvas = $('#touchpad-canvas');
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);

  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#272727';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  if (!touches) {
    $('#touch0-info').textContent = 'Touch 1: —';
    $('#touch1-info').textContent = 'Touch 2: —';
    return;
  }

  const colors = ['#ff8c00', '#ffd200'];
  touches.forEach((t, i) => {
    const info = `#touch${i}-info`;
    if (!t.active) {
      $(info).textContent = `Touch ${i + 1}: —`;
      return;
    }
    const tx = (t.x / TOUCHPAD_W) * (w - 8) + 4;
    const ty = (t.y / TOUCHPAD_H) * (h - 8) + 4;

    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.arc(tx, ty, 14 * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    $(info).textContent = `Touch ${i + 1}: id=${t.id} x=${t.x} y=${t.y}`;
  });
}

function updateMotion(state) {
  if (!state.gyro) {
    $('#motion-section').classList.add('hidden');
    return;
  }
  $('#motion-section').classList.remove('hidden');

  const { gyro, accel, sensorTimestamp } = state;
  $('#gyro-x').textContent = gyro.x;
  $('#gyro-y').textContent = gyro.y;
  $('#gyro-z').textContent = gyro.z;
  $('#accel-x').textContent = accel.x;
  $('#accel-y').textContent = accel.y;
  $('#accel-z').textContent = accel.z;
  $('#sensor-ts').textContent = sensorTimestamp;

  pushHistory('gyroX', gyro.x);
  pushHistory('gyroY', gyro.y);
  pushHistory('gyroZ', gyro.z);
  drawMotionChart($('#motion-chart'), motionHistory.gyroX);
}

function pushHistory(key, value) {
  motionHistory[key].push(value);
  if (motionHistory[key].length > HISTORY_LEN) {
    motionHistory[key].shift();
  }
}

function drawMotionChart(canvas, data) {
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) return;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  ctx.strokeStyle = '#ff8c00';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (HISTORY_LEN - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function updateBattery(battery) {
  if (!battery) {
    $('#battery-section').classList.add('hidden');
    return;
  }
  $('#battery-section').classList.remove('hidden');

  const level = Math.round(battery.level);
  $('#battery-level').textContent = `${level}%`;
  $('#battery-status').textContent = battery.charging
    ? 'Charging'
    : battery.full
      ? 'Full'
      : 'Discharging';

  const fill = $('#battery-fill');
  fill.style.width = `${level}%`;
  fill.classList.toggle('low', level < 20 && !battery.charging);
  fill.classList.toggle('charging', battery.charging);
}

function updateAdaptiveTriggers(triggers) {
  if (!triggers) {
    $('#adaptive-section').classList.add('hidden');
    return;
  }
  $('#adaptive-section').classList.remove('hidden');
  $('#l2-adaptive').textContent = `Force: ${triggers.l2.force ? 'Yes' : 'No'}, State: ${triggers.l2.state}`;
  $('#r2-adaptive').textContent = `Force: ${triggers.r2.force ? 'Yes' : 'No'}, State: ${triggers.r2.state}`;
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => {
  if (controller) {
    drawStick(stickCanvases.left.ctx, stickCanvases.left.canvas, 0, 0);
    drawStick(stickCanvases.right.ctx, stickCanvases.right.canvas, 0, 0);
  }
  drawGarminOscCharts();
  drawMacbookOscCharts();
  drawWeatherOscCharts();
  drawMicOscCharts();
  drawInSourceCharts();
  weatherMap?.resize();
});
