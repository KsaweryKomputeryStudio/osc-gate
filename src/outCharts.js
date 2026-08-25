/**
 * Right-hand output charts for the selected source instance.
 */

import { getInstance } from './session.js';
import { getSignalSpec, listKnownSignals, onSignalsChanged, processOutgoing, signalKey } from './signals.js';

const WINDOW_MS = 60_000;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export function setupOutCharts({ $, saveConfig, loadConfig }) {
  const dock = $('#out-dock');
  const body = $('#out-charts');
  const title = $('#out-dock-title');
  if (!dock || !body) return { push() {}, setSource() {}, render() {} };

  const bySource = new Map();
  const lastVal = new Map();
  let sourceId = '';
  let sourceLabel = 'Output';
  let timer = null;

  function seriesFor(id) {
    if (!id) return new Map();
    if (!bySource.has(id)) bySource.set(id, new Map());
    return bySource.get(id);
  }

  function applyWidth() {
    const w = Number(loadConfig().ui.outWidth);
    const px = Number.isFinite(w) && w >= 300 && w <= 720 ? Math.round(w) : 380;
    dock.style.setProperty('--out-w', `${px}px`);
    dock.style.removeProperty('width');
  }

  if (loadConfig().ui.outCollapsed) dock.classList.add('collapsed');
  applyWidth();

  $('#out-dock-toggle')?.addEventListener('click', () => {
    const collapsed = !dock.classList.contains('collapsed');
    dock.classList.toggle('collapsed', collapsed);
    applyWidth();
    saveConfig({ ui: { outCollapsed: collapsed } });
  });

  const handle = $('#out-dock-resize');
  if (handle) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = dock.getBoundingClientRect().width;
      dock.classList.add('resizing');
      const move = (ev) => {
        const next = Math.min(720, Math.max(300, startW - (ev.clientX - startX)));
        dock.style.setProperty('--out-w', `${next}px`);
      };
      const up = () => {
        dock.classList.remove('resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        saveConfig({ ui: { outWidth: Math.round(dock.getBoundingClientRect().width) } });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function setSource(id, label) {
    sourceId = id || '';
    sourceLabel = label || 'Output';
    if (title) title.textContent = sourceId ? sourceLabel : 'Output';
    render();
  }

  onSignalsChanged((id) => {
    if (id === sourceId) syncOff(getInstance(id));
  });

  function push(id, messages) {
    if (!id) return;
    const inst = getInstance(id);
    const shown = inst ? processOutgoing(inst, messages).shown : messages;
    const series = seriesFor(id);
    const now = Date.now();
    let added = false;
    const vals = lastVal.get(id) || {};
    for (const m of shown || []) {
      const addr = m.address;
      const n = Number(m.out ?? m.args?.[0]);
      if (!addr || !Number.isFinite(n)) continue;
      const key = inst ? signalKey(inst, addr) : addr;
      vals[key] = n;
      const list = series.get(addr) || [];
      if (!series.has(addr)) added = true;
      list.push({ t: now, v: n });
      series.set(
        addr,
        list.filter((p) => p.t >= now - WINDOW_MS),
      );
    }
    lastVal.set(id, vals);
    if (id === sourceId) {
      if (added) render();
      else fillVals(vals, inst);
    }
  }

  function collectRows(inst) {
    const series = seriesFor(sourceId);
    const rows = new Map();
    for (const s of listKnownSignals(inst)) rows.set(s.address, s);
    for (const addr of series.keys()) {
      if (!rows.has(addr)) {
        rows.set(addr, {
          key: inst ? signalKey(inst, addr) : addr.replace(/^\//, ''),
          address: addr,
          label: addr,
        });
      }
    }
    return [...rows.values()].sort((a, b) => a.address.localeCompare(b.address));
  }

  function fillVals(vals, inst) {
    for (const [key, val] of Object.entries(vals || {})) {
      const el = body.querySelector(`[data-out-val="${CSS.escape(key)}"]`);
      if (el) el.textContent = fmt(val);
    }
    syncOff(inst);
  }

  function syncOff(inst) {
    body.querySelectorAll('.out-chart-row[data-out-key]').forEach((row) => {
      const spec = inst ? getSignalSpec(inst, row.dataset.outKey) : { mode: 'raw' };
      row.classList.toggle('off', spec.mode === 'off');
    });
  }

  function render() {
    const inst = getInstance(sourceId);
    const rows = collectRows(inst);
    if (!sourceId) {
      body.innerHTML = '<p class="osc-hint">Select a source to see its outgoing signals.</p>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<p class="osc-hint">Waiting for OSC output…</p>';
      return;
    }
    const vals = lastVal.get(sourceId) || {};
    body.innerHTML = rows
      .map((row) => {
        const spec = inst ? getSignalSpec(inst, row.key) : { mode: 'raw' };
        const off = spec.mode === 'off' ? ' off' : '';
        return `<div class="out-chart-row${off}" data-out-key="${esc(row.key)}">
          <div class="out-chart-head">
            <span class="out-chart-addr">${esc(row.address)}</span>
            <span class="out-chart-val" data-out-val="${esc(row.key)}">${esc(fmt(vals[row.key]))}</span>
          </div>
          <canvas data-out-addr="${esc(row.address)}"></canvas>
        </div>`;
      })
      .join('');
    draw();
  }

  function draw() {
    const series = seriesFor(sourceId);
    const now = Date.now();
    body.querySelectorAll('canvas[data-out-addr]').forEach((canvas) => {
      const addr = canvas.dataset.outAddr;
      const pts = series.get(addr) || [];
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 240;
      const h = canvas.clientHeight || 48;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      if (pts.length < 2) return;
      const vs = pts.map((p) => p.v);
      let min = Math.min(...vs);
      let max = Math.max(...vs);
      if (min === max) {
        min -= 1;
        max += 1;
      }
      ctx.strokeStyle = 'rgb(255, 140, 0)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = ((p.t - (now - WINDOW_MS)) / WINDOW_MS) * w;
        const y = h - ((p.v - min) / (max - min)) * (h - 6) - 3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  timer = setInterval(draw, 250);

  return { push, setSource, render, draw };
}
