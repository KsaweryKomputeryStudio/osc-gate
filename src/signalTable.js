/**
 * Shared outgoing-signal table: OFF / RAW / AUTO01 / MAN01.
 */

import { getInstance } from './session.js';
import {
  getSignalSpec,
  listKnownSignals,
  mapOutgoingValue,
  onSignalsChanged,
  resetSignalObserved,
  setSignalSpec,
  signalObserved,
} from './signals.js';

const MODES = [
  { id: 'off', label: 'OFF' },
  { id: 'raw', label: 'RAW' },
  { id: 'auto', label: 'AUTO01' },
  { id: 'manual', label: 'MAN01' },
];

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

function rangeFor(inst, key, spec) {
  if (spec.mode === 'auto') {
    const obs = signalObserved(inst?.id, key);
    return { min: obs?.min, max: obs?.max, enabled: false, show: true };
  }
  if (spec.mode === 'manual') {
    return { min: spec.min, max: spec.max, enabled: true, show: true };
  }
  return { min: '', max: '', enabled: false, show: false };
}

export function signalTableHtml(inst, rows, { values = {} } = {}) {
  if (!inst) return '<p class="osc-hint">Select a source to configure signals.</p>';
  const body = (rows || listKnownSignals(inst))
    .map((row) => {
      const spec = getSignalSpec(inst, row.key);
      const range = rangeFor(inst, row.key, spec);
      const val = values[row.key] ?? values[row.address];
      const mapped = mapOutgoingValue(inst, row.key, val);
      const modes = MODES.map(
        (m) =>
          `<button type="button" data-sig-mode="${m.id}" class="${spec.mode === m.id ? 'active' : ''}">${m.label}</button>`,
      ).join('');
      return `<tr class="signal-row mode-${spec.mode}" data-sig-key="${esc(row.key)}" data-sig-addr="${esc(row.address)}">
        <td>
          <div class="signal-name">${esc(row.label)}</div>
          <div class="signal-addr">${esc(row.address)}</div>
        </td>
        <td class="signal-in" data-sig-in="${esc(row.key)}">${esc(fmt(val))}</td>
        <td><div class="signal-modes">${modes}</div></td>
        <td>
          <input class="text-input signal-range" data-sig-min type="number" step="any" ${range.enabled ? '' : 'readonly'} ${range.show ? '' : 'disabled'} value="${range.min ?? ''}" />
        </td>
        <td>
          <input class="text-input signal-range" data-sig-max type="number" step="any" ${range.enabled ? '' : 'readonly'} ${range.show ? '' : 'disabled'} value="${range.max ?? ''}" />
        </td>
        <td class="signal-reset-cell">
          ${spec.mode === 'auto' ? '<button type="button" class="signal-reset" data-sig-reset title="Reset observed range" aria-label="Reset observed range"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.65 2.35A7 7 0 1 0 15 8h-1.5a5.5 5.5 0 1 1-1.1-3.4L10 6h5V1Z"/></svg></button>' : ''}
        </td>
        <td class="signal-out" data-sig-out="${esc(row.key)}">${esc(fmt(mapped))}</td>
      </tr>`;
    })
    .join('');
  return `<table class="signal-table" data-source-id="${esc(inst.id)}">
    <thead>
      <tr>
        <th>Signal</th>
        <th>In</th>
        <th>Mode</th>
        <th>Min</th>
        <th>Max</th>
        <th class="signal-reset-head"></th>
        <th>Out</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function fillSignalTableValues(root, values, inst) {
  if (!root) return;
  const merged = inst?.id ? { ...(lastValues.get(inst.id) || {}), ...(values || {}) } : values || {};
  for (const [key, val] of Object.entries(values || {})) {
    const inn = root.querySelector(`[data-sig-in="${CSS.escape(key)}"]`);
    if (inn) inn.textContent = fmt(val);
  }
  if (!inst) return;
  root.querySelectorAll('.signal-row[data-sig-key]').forEach((row) => {
    const key = row.dataset.sigKey;
    const spec = getSignalSpec(inst, key);
    if (spec.mode === 'auto') {
      const obs = signalObserved(inst.id, key);
      const min = row.querySelector('[data-sig-min]');
      const max = row.querySelector('[data-sig-max]');
      if (min && document.activeElement !== min) min.value = obs?.min ?? '';
      if (max && document.activeElement !== max) max.value = obs?.max ?? '';
    }
    const out = row.querySelector(`[data-sig-out="${CSS.escape(key)}"]`);
    if (out) out.textContent = fmt(mapOutgoingValue(inst, key, merged[key] ?? merged[row.dataset.sigAddr]));
  });
}

let bound = false;
const lastValues = new Map();

export function bindSignalTable() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    const reset = e.target.closest('[data-sig-reset]');
    if (reset) {
      const row = reset.closest('[data-sig-key]');
      const table = row?.closest('[data-source-id]');
      if (row && table) resetSignalObserved(table.dataset.sourceId, row.dataset.sigKey);
      return;
    }
    const btn = e.target.closest('[data-sig-mode]');
    const row = btn?.closest('[data-sig-key]');
    const table = row?.closest('[data-source-id]');
    if (!btn || !row || !table) return;
    setSignalSpec(table.dataset.sourceId, row.dataset.sigKey, { mode: btn.dataset.sigMode });
  });
  document.addEventListener('change', (e) => {
    const input = e.target.closest('[data-sig-min], [data-sig-max]');
    const row = input?.closest('[data-sig-key]');
    const table = row?.closest('[data-source-id]');
    if (!input || !row || !table) return;
    const patch = input.hasAttribute('data-sig-min')
      ? { min: Number(input.value) }
      : { max: Number(input.value) };
    setSignalSpec(table.dataset.sourceId, row.dataset.sigKey, patch);
  });
}

function panelEls() {
  return {
    panel: document.getElementById('source-signals'),
    body: document.getElementById('source-signals-body'),
    toggle: document.getElementById('source-signals-toggle'),
  };
}

function applyCollapsed(collapsed) {
  const { panel, toggle } = panelEls();
  panel?.classList.toggle('collapsed', collapsed);
  toggle?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

export function hideSourceSignals() {
  const { panel } = panelEls();
  const park = document.getElementById('view-empty');
  if (!panel) return;
  panel.classList.add('hidden');
  park?.appendChild(panel);
}

export function showSourceSignals(inst, view, values = {}) {
  const { panel, body } = panelEls();
  if (!panel || !body) return;
  if (!inst || !view) {
    hideSourceSignals();
    return;
  }
  if (Object.keys(values).length) lastValues.set(inst.id, { ...(lastValues.get(inst.id) || {}), ...values });
  panel.classList.remove('hidden');
  const settings = view.querySelector('.source-settings');
  if (settings) settings.after(panel);
  else view.prepend(panel);
  body.innerHTML = signalTableHtml(inst, listKnownSignals(inst), {
    values: lastValues.get(inst.id) || {},
  });
}

export function fillSourceSignals(values, inst) {
  if (inst?.id) lastValues.set(inst.id, { ...(lastValues.get(inst.id) || {}), ...(values || {}) });
  fillSignalTableValues(document.getElementById('source-signals-body'), values, inst);
}

export function setupSourceSignals({ loadConfig, saveConfig }) {
  bindSignalTable();
  applyCollapsed(!!loadConfig().ui.signalsCollapsed);
  document.getElementById('source-signals-toggle')?.addEventListener('click', () => {
    const { panel } = panelEls();
    const collapsed = !panel?.classList.contains('collapsed');
    applyCollapsed(collapsed);
    saveConfig({ ui: { signalsCollapsed: collapsed } });
  });
  onSignalsChanged((id) => {
    const { panel, body } = panelEls();
    if (!panel || !body || panel.classList.contains('hidden')) return;
    if (panel.querySelector('[data-source-id]')?.dataset.sourceId !== id) return;
    const inst = getInstance(id);
    if (!inst) return;
    body.innerHTML = signalTableHtml(inst, listKnownSignals(inst), {
      values: lastValues.get(id) || {},
    });
  });
}
