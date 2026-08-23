/**
 * Session file save / open / new. Last session lives in localStorage.
 */

import { loadConfig, replaceConfig, saveConfig } from './config.js';
import { defaultInstanceName, newSourceId, nextSlot, sourceType } from './sourceCatalog.js';

export function sessionName() {
  return loadConfig().session?.name || 'untitled';
}

export function setSessionName(name) {
  saveConfig({ session: { name: String(name || 'untitled').trim() || 'untitled' } });
}

export function listInstances() {
  return loadConfig().sources || [];
}

export function getInstance(id) {
  return listInstances().find((s) => s.id === id) || null;
}

export function instancesOfType(type) {
  return listInstances().filter((s) => s.type === type);
}

export function addInstance(type, extraSettings = {}) {
  const spec = sourceType(type);
  if (!spec) throw new Error(`Unknown source type ${type}`);
  const current = listInstances();
  const slot = nextSlot(current, type);
  const inst = {
    id: newSourceId(),
    type,
    slot,
    name: defaultInstanceName(type, slot),
    settings: { ...(spec.defaults || {}), ...extraSettings },
    signals: {},
  };
  saveConfig({
    sources: [...current, inst],
    ui: { activeSection: inst.id },
  });
  return inst;
}

export function removeInstance(id) {
  const next = listInstances().filter((s) => s.id !== id);
  const cfg = loadConfig();
  const active = cfg.ui.activeSection === id ? next[0]?.id || '' : cfg.ui.activeSection;
  saveConfig({ sources: next, ui: { activeSection: active } });
  return next;
}

export function patchInstance(id, patch) {
  const next = listInstances().map((s) => {
    if (s.id !== id) return s;
    const settings = patch.settings ? { ...s.settings, ...patch.settings } : s.settings;
    return { ...s, ...patch, settings };
  });
  saveConfig({ sources: next });
  return next.find((s) => s.id === id) || null;
}

export function newSession() {
  const cfg = loadConfig();
  replaceConfig({
    ...cfg,
    session: { name: 'untitled' },
    sources: [],
    ui: { ...cfg.ui, activeSection: '' },
  });
}

export function downloadSession() {
  const cfg = loadConfig();
  const name = String(cfg.session?.name || 'untitled').replace(/[^\w.-]+/g, '_') || 'untitled';
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.oscgate.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function openSessionFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a session file');
  const name = parsed.session?.name || file.name.replace(/\.oscgate\.json$/i, '').replace(/\.json$/i, '') || 'untitled';
  parsed.session = { ...(parsed.session || {}), name };
  replaceConfig(parsed);
}
