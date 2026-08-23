/**
 * Session UI, source list, picker (key 1), and poll-source runner.
 */

import { loadConfig, saveConfig } from './config.js';
import { fetchPoll } from './pollFetchers.js';
import {
  SOURCE_CATEGORIES,
  instanceAddress,
  instanceLabel,
  instancePrefix,
  rewriteAddress,
  sourceType,
  typeNeedsKey,
} from './sourceCatalog.js';
import { GeoMap, readBrowserLocation } from './geoMap.js';
import {
  addInstance,
  downloadSession,
  getInstance,
  listInstances,
  newSession,
  openSessionFile,
  patchInstance,
  removeInstance,
  sessionName,
  setSessionName,
} from './session.js';
import { processOutgoing, seedInstanceSignals } from './signals.js';
import { fillSourceSignals, hideSourceSignals, showSourceSignals } from './signalTable.js';

const pollRuns = new Map();
let pollMap = null;
let pollLocCtx = null;

const KEY_ICON =
  '<svg class="key-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M10.2 2.2a3.8 3.8 0 0 0-3.6 4.9L1.5 12.2V14.5H4v-1.5h1.5V11.5H7l1.4-1.4a3.8 3.8 0 1 0 1.8-7.9Zm0 2.3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/></svg>';

export function setupSourceStudio({ $, $$, setActiveSection, oscBridge, outCharts }) {
  const filter = $('#source-picker-filter');

  renderSessionName($);
  renderSourceNav($, setActiveSection);
  renderPickerList($, '');
  setupSourceTip();

  $('#session-name')?.addEventListener('change', (e) => {
    setSessionName(e.target.value);
    renderSessionName($);
  });
  $('#session-save')?.addEventListener('click', () => {
    setSessionName($('#session-name')?.value || sessionName());
    downloadSession();
  });
  $('#session-new')?.addEventListener('click', () => {
    if (listInstances().length && !confirm('Start a new empty session? Unsaved changes stay only in this browser until you Save.')) {
      return;
    }
    stopAllPolls();
    newSession();
    location.reload();
  });
  $('#session-open')?.addEventListener('click', () => $('#session-file')?.click());
  $('#session-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      stopAllPolls();
      await openSessionFile(file);
      location.reload();
    } catch (err) {
      alert(err.message || 'Could not open session');
    }
  });

  $('#source-add-btn')?.addEventListener('click', () => openPicker($, filter));
  $('#source-add-btn-2')?.addEventListener('click', () => openPicker($, filter));
  $$('[data-close-picker]').forEach((el) => el.addEventListener('click', () => closePicker($)));

  filter?.addEventListener('input', () => {
    renderPickerList($, filter.value);
  });

  document.addEventListener('keydown', (e) => {
    const typing = isTypingTarget(e.target);
    const open = !$('#source-picker')?.classList.contains('hidden');
    if (open) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker($);
      }
      return;
    }
    if (!typing && e.key === '1' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openPicker($, filter);
    }
  });

  $('#source-picker-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type]');
    if (btn) addAndSelect(btn.dataset.type, $, setActiveSection, { oscBridge, outCharts });
  });

  $('#nav-sources')?.addEventListener('click', (e) => {
    const del = e.target.closest('.nav-in-del');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      const id = del.dataset.id;
      stopPoll(id);
      removeInstance(id);
      renderSourceNav($, setActiveSection);
      setActiveSection(loadConfig().ui.activeSection || '');
      return;
    }
    const sel = e.target.closest('.nav-select');
    if (sel) setActiveSection(sel.dataset.section);
  });

  $('#poll-start-btn')?.addEventListener('click', () => {
    const inst = getInstance(loadConfig().ui.activeSection);
    if (inst) startPoll(inst, { $, oscBridge, outCharts });
  });
  $('#poll-stop-btn')?.addEventListener('click', () => {
    const inst = getInstance(loadConfig().ui.activeSection);
    if (inst) stopPoll(inst.id);
    refreshPollChrome($, inst);
  });
  $('#poll-settings')?.addEventListener('change', (e) => {
    const input = e.target.closest('[data-poll-key]');
    if (!input) return;
    const inst = getInstance(loadConfig().ui.activeSection);
    if (!inst) return;
    const key = input.dataset.pollKey;
    const value = input.type === 'number' ? Number(input.value) : input.value;
    const next = patchInstance(inst.id, { settings: { [key]: value } });
    if (key === 'lat' || key === 'lon') syncPollLocation($, next, { fly: false });
    if (pollRuns.has(inst.id)) {
      stopPoll(inst.id);
      startPoll(next, { $, oscBridge, outCharts });
    } else if (key === 'apiKey' && String(value).trim()) {
      startPoll(next, { $, oscBridge, outCharts });
    }
  });
  pollLocCtx = { $, oscBridge, outCharts };
  $('#poll-locate-btn')?.addEventListener('click', () => locatePollBrowser());

  if (oscBridge) oscBridge.onOutgoing = (source, messages) => outCharts?.push(source, messages);

  queueMicrotask(() => {
    for (const inst of listInstances()) {
      const spec = sourceType(inst.type);
      if (spec?.kind === 'poll' && inst.settings?.autoStart !== false && !missingApiKey(inst)) {
        startPoll(inst, { $, oscBridge, outCharts });
      }
    }
  });

  return {
    renderSourceNav: () => renderSourceNav($, setActiveSection),
    activateInstance: (id) => onActivate(id, $, oscBridge, outCharts),
    sendFrom: (inst, messages) => sendFrom(oscBridge, inst, messages, outCharts),
    setTypeDot,
    activeInstance: () => getInstance(loadConfig().ui.activeSection),
  };
}

function renderSessionName($) {
  if ($('#session-name')) $('#session-name').value = sessionName();
}

export function renderSourceNav($, setActiveSection) {
  const host = $('#nav-sources');
  if (!host) return;
  const active = loadConfig().ui.activeSection;
  const sources = listInstances();
  if (!sources.length) {
    host.innerHTML = '<p class="nav-hint">Empty session. Press 1 to add a source.</p>';
    return;
  }
  host.innerHTML = sources
    .map((s) => {
      const spec = sourceType(s.type);
      return `<section class="nav-section ${s.id === active ? 'active' : ''}" data-section="${esc(s.id)}">
        <div class="nav-section-head">
          <button type="button" class="nav-select" data-section="${esc(s.id)}" data-source-tip="${esc(spec?.hint || '')}" data-source-tip-name="${esc(instanceLabel(s))}">
            <span class="nav-icon">${esc(spec?.icon || '·')}</span>
            <span class="nav-label">${esc(instanceLabel(s))}</span>
            <span class="nav-dot" data-src-dot="${esc(s.id)}"></span>
          </button>
          <button type="button" class="nav-in-del" data-id="${esc(s.id)}" aria-label="Remove source">×</button>
        </div>
      </section>`;
    })
    .join('');
}

function openPicker($, filter) {
  const el = $('#source-picker');
  if (!el) return;
  hideSourceTip();
  el.hidden = false;
  el.classList.remove('hidden');
  if (filter) {
    filter.value = '';
    renderPickerList($, '');
    requestAnimationFrame(() => filter.focus());
  }
}

function closePicker($) {
  const el = $('#source-picker');
  if (!el) return;
  el.hidden = true;
  el.classList.add('hidden');
  hideSourceTip();
}

function renderPickerList($, q) {
  const host = $('#source-picker-list');
  if (!host) return;
  const query = String(q || '').trim().toLowerCase();
  host.innerHTML = SOURCE_CATEGORIES.map((cat) => {
    const types = cat.types.filter((t) => matchesType(t, cat, query));
    if (!types.length) return '';
    const items = types
      .map((t) => {
        const keyMark = typeNeedsKey(t)
          ? `<span class="source-picker-key" title="Needs API key" aria-label="Needs API key">${KEY_ICON}</span>`
          : '';
        return `<button type="button" class="source-picker-item" data-type="${esc(t.id)}" data-source-tip="${esc(t.hint || '')}" data-source-tip-name="${esc(t.label)}">
          <span class="nav-icon">${esc(t.icon)}</span>
          <span>${esc(t.label)}</span>
          ${keyMark}
        </button>`;
      })
      .join('');
    return `<div class="source-picker-col"><div class="source-picker-cat">${esc(cat.label)}</div><div class="source-picker-types">${items}</div></div>`;
  }).join('');
}

function matchesType(t, cat, query) {
  if (!query) return true;
  return [t.id, t.label, t.hint, cat.label].some((s) => String(s || '').toLowerCase().includes(query));
}

function addAndSelect(type, $, setActiveSection, ctx) {
  const inst = seedInstanceSignals(addInstance(type));
  closePicker($);
  renderSourceNav($, setActiveSection);
  setActiveSection(inst.id);
  if (sourceType(type)?.kind === 'poll' && !missingApiKey(inst)) startPoll(inst, { $, ...ctx });
}

function onActivate(id, $, oscBridge, outCharts) {
  const inst = getInstance(id);
  const spec = sourceType(inst?.type);
  $$hide($);
  if (!inst) {
    hideSourceSignals();
    $('#view-empty')?.classList.remove('hidden');
    outCharts?.setSource('', 'Output');
    return;
  }
  outCharts?.setSource(inst.id, instanceLabel(inst));
  if (spec?.kind === 'poll') {
    const view = $('#view-poll');
    view?.classList.remove('hidden');
    renderPollView($, inst);
    refreshPollChrome($, inst);
    showSourceSignals(inst, view);
    return;
  }
  const view = $(`#view-${inst.type}`);
  if (view) {
    view.classList.remove('hidden');
    showSourceSignals(inst, view);
  } else {
    hideSourceSignals();
    $('#view-empty')?.classList.remove('hidden');
  }
}

function $$hide($) {
  [
    'empty',
    'poll',
    'controller',
    'garmin',
    'macbook',
    'weather',
    'mic',
    'time',
    'human',
    'insource',
  ].forEach((id) => $(`#view-${id}`)?.classList.add('hidden'));
}

function renderPollView($, inst) {
  const spec = sourceType(inst.type);
  if ($('#poll-hint')) $('#poll-hint').textContent = spec?.hint || '';
  if ($('#poll-prefix')) $('#poll-prefix').textContent = `OSC ${instancePrefix(inst)}/…`;
  if ($('#poll-hero-unit')) $('#poll-hero-unit').textContent = spec?.heroUnit || '';
  if ($('#poll-hero-name')) $('#poll-hero-name').textContent = instanceLabel(inst);
  const host = $('#poll-settings');
  if (!host) return;
  const settings = inst.settings || {};
  const rows = [];
  if (settings.intervalSec != null) {
    rows.push(fieldHtml('intervalSec', 'Refresh (sec)', settings.intervalSec, 'number'));
  }
  if (settings.lat != null) rows.push(fieldHtml('lat', 'Latitude', settings.lat, 'number'));
  if (settings.lon != null) rows.push(fieldHtml('lon', 'Longitude', settings.lon, 'number'));
  if (settings.minMag != null) rows.push(fieldHtml('minMag', 'Min magnitude', settings.minMag, 'number'));
  if (settings.stationId != null) rows.push(fieldHtml('stationId', 'Station id', settings.stationId, 'number'));
  if (settings.stationName != null) rows.push(fieldHtml('stationName', 'Station', settings.stationName, 'text'));
  if (settings.pair != null) rows.push(fieldHtml('pair', 'Pair', settings.pair, 'text'));
  if (settings.currency != null) rows.push(fieldHtml('currency', 'Currency', settings.currency, 'text'));
  if (settings.city != null) rows.push(fieldHtml('city', 'City', settings.city, 'text'));
  if (settings.apiKey != null || typeNeedsKey(spec)) {
    rows.push(
      fieldHtml('apiKey', 'API key', settings.apiKey ?? '', 'password', {
        autocomplete: 'off',
        spellcheck: 'false',
        keyIcon: true,
      }),
    );
  }
  host.innerHTML = rows.join('');
  syncPollLocation($, inst, { fly: true });
}

function fieldHtml(key, label, value, type, extra = {}) {
  const { keyIcon, ...attrsIn } = extra;
  const attrs = Object.entries(attrsIn)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ');
  const title = keyIcon ? `${KEY_ICON} ${esc(label)}` : esc(label);
  return `<div class="control-group">
    <label class="${keyIcon ? 'poll-key-label' : ''}">${title}</label>
    <input class="text-input" data-poll-key="${esc(key)}" type="${type}" step="any" value="${esc(value)}" ${attrs} />
  </div>`;
}

function missingApiKey(inst) {
  if (!typeNeedsKey(sourceType(inst?.type))) return false;
  return !String(inst?.settings?.apiKey || '').trim();
}

function hasLocation(inst) {
  return inst?.settings?.lat != null && inst?.settings?.lon != null;
}

function ensurePollMap($) {
  const host = $('#poll-map');
  if (!host) return null;
  if (pollMap) return pollMap;
  pollMap = new GeoMap(host, {
    lat: 52.23,
    lon: 21.01,
    zoom: 6,
    onPick: ({ lat, lon }) => applyPollLocation(lat, lon, 'map'),
  });
  return pollMap;
}

function syncPollLocation($, inst, { fly = false } = {}) {
  const box = $('#poll-location');
  if (!box) return;
  const on = hasLocation(inst);
  box.classList.toggle('hidden', !on);
  if (!on) return;
  const map = ensurePollMap($);
  const lat = Number(inst.settings.lat);
  const lon = Number(inst.settings.lon);
  if (map && Number.isFinite(lat) && Number.isFinite(lon)) {
    map.setPick(lat, lon, { fly });
    requestAnimationFrame(() => map.resize());
  }
  if ($('#poll-location-label')) {
    $('#poll-location-label').textContent = Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(4)}, ${lon.toFixed(4)} · click map or use browser location`
      : 'Click the map or use browser location.';
  }
}

function applyPollLocation(lat, lon, source) {
  const { $, oscBridge, outCharts } = pollLocCtx || {};
  const inst = getInstance(loadConfig().ui.activeSection);
  if (!inst || !hasLocation(inst)) return;
  const next = patchInstance(inst.id, { settings: { lat, lon } });
  const latEl = document.querySelector('[data-poll-key="lat"]');
  const lonEl = document.querySelector('[data-poll-key="lon"]');
  if (latEl) latEl.value = String(Math.round(lat * 1e5) / 1e5);
  if (lonEl) lonEl.value = String(Math.round(lon * 1e5) / 1e5);
  if ($('#poll-location-label')) {
    $('#poll-location-label').textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)} · ${source === 'gps' ? 'browser GPS' : 'map'}`;
  }
  pollMap?.setPick(lat, lon, { fly: source === 'gps' });
  if (next && pollRuns.has(inst.id)) {
    stopPoll(inst.id);
    startPoll(next, { $, oscBridge, outCharts });
  }
}

function locatePollBrowser() {
  const label = document.querySelector('#poll-location-label');
  if (label) label.textContent = 'Reading browser location…';
  readBrowserLocation()
    .then(({ lat, lon }) => applyPollLocation(lat, lon, 'gps'))
    .catch((err) => {
      if (label) label.textContent = err.message || 'Location unavailable';
    });
}

function refreshPollChrome($, inst) {
  const running = !!(inst && pollRuns.has(inst.id));
  $('#poll-status-dot')?.classList.toggle('connected', running);
  if ($('#poll-status-text')) {
    $('#poll-status-text').textContent = running
      ? 'Live'
      : missingApiKey(inst)
        ? 'API key required'
        : 'Idle';
  }
  if ($('#poll-start-btn')) $('#poll-start-btn').disabled = running;
  if ($('#poll-stop-btn')) $('#poll-stop-btn').disabled = !running;
}

function startPoll(inst, { $, oscBridge, outCharts }) {
  stopPoll(inst.id);
  const spec = sourceType(inst.type);
  if (!spec || spec.kind !== 'poll') return;
  if (missingApiKey(inst)) {
    refreshPollChrome($, inst);
    return;
  }
  const tick = async () => {
    const run = pollRuns.get(inst.id);
    if (!run) return;
    try {
      const result = await fetchPoll(inst.type, inst.settings, run.last);
      run.last = result;
      const values = result.values || {};
      applyPollSample($, inst, spec, result);
      const messages = (spec.fields || []).map((f) => ({
        address: instanceAddress(inst, f.id),
        args: [Number(values[f.id]) || 0],
      }));
      sendFrom(oscBridge, inst, messages, outCharts);
      setTypeDot(inst.type, { connected: true });
    } catch (err) {
      if ($('#poll-status-text') && getInstance(loadConfig().ui.activeSection)?.id === inst.id) {
        $('#poll-status-text').textContent = err.message || 'Error';
      }
      setTypeDot(inst.type, { connected: false });
    }
  };
  const ms = Math.max(2000, Number(inst.settings?.intervalSec || 30) * 1000);
  const timer = setInterval(tick, ms);
  pollRuns.set(inst.id, { timer, last: null });
  refreshPollChrome($, inst);
  tick();
}

function applyPollSample($, inst, spec, result) {
  if (getInstance(loadConfig().ui.activeSection)?.id !== inst.id) return;
  const hero = spec.hero;
  const v = result.values?.[hero];
  if ($('#poll-hero-value')) {
    $('#poll-hero-value').textContent =
      v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v);
  }
  if ($('#poll-hero-name')) $('#poll-hero-name').textContent = result.label || instanceLabel(inst);
  fillSourceSignals(result.values || {}, inst);
}

function stopPoll(id) {
  const run = pollRuns.get(id);
  if (run?.timer) clearInterval(run.timer);
  pollRuns.delete(id);
}

function stopAllPolls() {
  for (const id of [...pollRuns.keys()]) stopPoll(id);
}

export function sendFrom(oscBridge, inst, messages, outCharts) {
  if (!inst || !messages?.length) return;
  const out = messages.map((m) => ({ ...m, address: rewriteAddress(inst, m.address) }));
  const { sent } = processOutgoing(inst, out);
  outCharts?.push(inst.id, out);
  oscBridge?.sendMessages(sent, { source: inst.id, processed: true });
}

export function setTypeDot(type, { connected, connecting } = {}) {
  for (const inst of listInstances().filter((s) => s.type === type)) {
    const el = document.querySelector(`[data-src-dot="${inst.id}"]`);
    el?.classList.toggle('connected', !!connected);
    el?.classList.toggle('connecting', !!connecting && !connected);
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

let tipShowT = 0;
let tipHideT = 0;
let tipCurrent = null;
let tipPending = null;

function sourceTipEl() {
  return document.getElementById('source-tip');
}

function hideSourceTip() {
  clearTimeout(tipShowT);
  clearTimeout(tipHideT);
  tipCurrent = null;
  tipPending = null;
  const tip = sourceTipEl();
  if (!tip) return;
  tip.classList.remove('visible');
  tip.hidden = true;
  tip.innerHTML = '';
}

function placeSourceTip(tip, anchor) {
  const r = anchor.getBoundingClientRect();
  const pad = 8;
  const sidebar = !!anchor.closest('.sidebar');
  tip.style.left = '0px';
  tip.style.top = '0px';
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let x = sidebar ? r.right + pad : r.left;
  let y = sidebar ? r.top + (r.height - th) / 2 : r.bottom + pad;
  if (!sidebar && y + th > window.innerHeight - pad) y = r.top - th - pad;
  x = Math.min(Math.max(pad, x), window.innerWidth - tw - pad);
  y = Math.min(Math.max(pad, y), window.innerHeight - th - pad);
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}

function showSourceTip(el) {
  const tip = sourceTipEl();
  const text = el?.getAttribute('data-source-tip') || '';
  if (!tip || !text) {
    hideSourceTip();
    return;
  }
  tipCurrent = el;
  tipPending = el;
  const name = el.getAttribute('data-source-tip-name') || '';
  const inSidebar = !!el.closest('.sidebar');
  const collapsed = inSidebar && document.getElementById('sidebar')?.classList.contains('collapsed');
  tip.innerHTML = collapsed && name ? `<span class="source-tip-name">${esc(name)}</span>${esc(text)}` : esc(text);
  tip.hidden = false;
  placeSourceTip(tip, el);
  tip.classList.add('visible');
}

function setupSourceTip() {
  if (setupSourceTip.bound) return;
  setupSourceTip.bound = true;
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('[data-source-tip]');
    if (!el || el === tipCurrent || el === tipPending) return;
    tipPending = el;
    clearTimeout(tipHideT);
    clearTimeout(tipShowT);
    tipShowT = setTimeout(() => showSourceTip(el), 160);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.('[data-source-tip]');
    if (!el) return;
    const next = e.relatedTarget?.closest?.('[data-source-tip]');
    if (next === el) return;
    if (tipPending === el) tipPending = null;
    clearTimeout(tipShowT);
    if (tipCurrent === el) {
      tipHideT = setTimeout(hideSourceTip, 80);
    }
  });
  window.addEventListener('scroll', hideSourceTip, true);
  window.addEventListener('resize', hideSourceTip);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
