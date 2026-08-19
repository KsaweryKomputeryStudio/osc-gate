/**
 * Collapsible incoming-OSC dock: raw log + compact per-address charts.
 */

const LOG_LIMIT = 400;
const MSG_LIMIT = 24;
const CHART_WINDOW_MS = 30_000;

export function setupOscInMonitor({
  $,
  $$,
  loadConfig,
  saveConfig,
  getInSources = () => [],
  onDiscover,
  onRename,
  onRemove,
}) {
  const dock = $('#osc-in-dock');
  if (!dock) return { push() {}, renderSources() {} };

  const saved = loadConfig().ui || {};
  dock.classList.toggle('collapsed', !!saved.oscInCollapsed);
  setMode(saved.oscInMode === 'raw' ? 'raw' : 'compact');
  applyHeight(saved.oscInHeight);

  let log = [];
  const bySource = new Map();
  let fromFilter = new Set(); // empty = all
  let textFilter = '';
  let chartTimer = null;

  setupResize();

  $('#osc-in-toggle')?.addEventListener('click', () => {
    const collapsed = !dock.classList.contains('collapsed');
    dock.classList.toggle('collapsed', collapsed);
    saveConfig({ ui: { oscInCollapsed: collapsed } });
    if (!collapsed) {
      applyHeight(loadConfig().ui.oscInHeight);
      render();
      startCharts();
    } else {
      stopCharts();
    }
  });

  $$('[data-osc-in-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.oscInMode;
      setMode(mode);
      saveConfig({ ui: { oscInMode: mode } });
      render();
    });
  });

  $('#osc-in-filter')?.addEventListener('input', (e) => {
    textFilter = String(e.target.value || '').trim().toLowerCase();
    render();
  });

  $('#osc-in-clear')?.addEventListener('click', () => {
    log = [];
    bySource.clear();
    fromFilter = new Set();
    renderFromChips();
    render();
  });

  if (!saved.oscInCollapsed) startCharts();
  renderFromChips();

  function setMode(mode) {
    dock.dataset.mode = mode;
    $$('[data-osc-in-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.oscInMode === mode);
    });
    $('#osc-in-raw')?.classList.toggle('hidden', mode !== 'raw');
    $('#osc-in-compact')?.classList.toggle('hidden', mode !== 'compact');
  }

  function clampHeight(h) {
    const col = dock.parentElement;
    const max = Math.max(140, (col?.clientHeight || window.innerHeight) - 80);
    return Math.round(Math.min(max, Math.max(100, Number(h) || 280)));
  }

  function applyHeight(h) {
    dock.style.setProperty('--osc-in-h', `${clampHeight(h)}px`);
  }

  function setupResize() {
    const handle = $('#osc-in-resize');
    if (!handle) return;
    let drag = null;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const wasCollapsed = dock.classList.contains('collapsed');
      if (wasCollapsed) {
        dock.classList.remove('collapsed');
        startCharts();
        render();
      }
      drag = {
        startY: e.clientY,
        startH: wasCollapsed ? 36 : dock.getBoundingClientRect().height,
      };
      dock.classList.add('resizing');
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      applyHeight(drag.startH - (e.clientY - drag.startY));
    });

    const endDrag = (e) => {
      if (!drag) return;
      drag = null;
      dock.classList.remove('resizing');
      const h = clampHeight(dock.getBoundingClientRect().height);
      applyHeight(h);
      saveConfig({ ui: { oscInCollapsed: false, oscInHeight: h } });
      if (e?.pointerId != null) {
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {
          // already released
        }
      }
    };

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  function matches(entry) {
    if (fromFilter.size && !fromFilter.has(entry.from || 'unknown')) return false;
    if (!textFilter) return true;
    const blob = `${entry.address} ${fmtArgs(entry.args)} ${entry.from || ''}`.toLowerCase();
    return blob.includes(textFilter);
  }

  function push(msg) {
    const args = (msg.args || []).map((a) => (a && typeof a === 'object' && 'value' in a ? a.value : a));
    const entry = {
      t: performance.now(),
      address: msg.address || '',
      args,
      from: msg.from || 'unknown',
    };
    log.push(entry);
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);

    let group = bySource.get(entry.from);
    if (!group) {
      group = { open: true, endpoints: new Map() };
      bySource.set(entry.from, group);
      renderFromChips();
    }
    let slot = group.endpoints.get(entry.address);
    if (!slot) {
      slot = { address: entry.address, from: entry.from, messages: [], samples: [], open: false };
      group.endpoints.set(entry.address, slot);
    }
    slot.messages.push(entry);
    if (slot.messages.length > MSG_LIMIT) slot.messages.shift();
    const num = args.find((v) => typeof v === 'number');
    slot.samples.push({ t: entry.t, v: Number.isFinite(num) ? num : 0 });
    const cutoff = entry.t - CHART_WINDOW_MS - 1000;
    while (slot.samples.length > 1 && slot.samples[1].t < cutoff) slot.samples.shift();

    if (!matches(entry)) return;
    if (dock.classList.contains('collapsed')) {
      bumpBadge();
      return;
    }
    if (dock.dataset.mode === 'raw') appendRaw(entry);
    else upsertCompact(slot);
    bumpBadge();
  }

  function bumpBadge() {
    const el = $('#osc-in-count');
    if (el) el.textContent = String(log.length);
  }

  function fmtArgs(args) {
    return (args || [])
      .map((v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v)))
      .join(' ');
  }

  function sourceLabel(from) {
    const src = (getInSources() || []).find((s) => s.from === from);
    return src?.name || from || 'unknown';
  }

  function fmtLine(e) {
    const t = new Date(Date.now() - (performance.now() - e.t)).toISOString().slice(11, 23);
    return `${t}  ${sourceLabel(e.from)}  ${e.address}  ${fmtArgs(e.args)}`;
  }

  function appendRaw(entry) {
    const pre = $('#osc-in-raw');
    if (!pre) return;
    pre.textContent = `${pre.textContent}${fmtLine(entry)}\n`.split('\n').slice(-LOG_LIMIT).join('\n');
    pre.scrollTop = pre.scrollHeight;
  }

  function renderFromChips() {
    const wrap = $('#osc-in-from-filters');
    if (!wrap) return;
    wrap.innerHTML = '';
    const sources = getInSources() || [];
    if (!sources.length) {
      wrap.innerHTML = '<span class="osc-in-muted">No sources yet</span>';
      return;
    }
    for (const src of sources) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'osc-in-chip';
      if (!fromFilter.size || fromFilter.has(src.from)) btn.classList.add('active');
      btn.textContent = src.name || src.from;
      btn.title = src.from;
      btn.addEventListener('click', () => {
        const all = new Set(sources.map((s) => s.from));
        if (!fromFilter.size) {
          fromFilter = new Set(all);
          fromFilter.delete(src.from);
        } else if (fromFilter.has(src.from)) {
          fromFilter.delete(src.from);
        } else {
          fromFilter.add(src.from);
        }
        if (fromFilter.size === all.size) fromFilter = new Set();
        renderFromChips();
        render();
      });
      wrap.appendChild(btn);
    }
  }

  function upsertCompact(slot) {
    const root = $('#osc-in-compact');
    if (!root) return;
    const el = [...root.querySelectorAll('.osc-in-ep')].find(
      (node) => node.dataset.from === slot.from && node.dataset.addr === slot.address,
    );
    if (!el) {
      renderCompact();
      return;
    }
    const list = el.querySelector('.osc-in-msg-list');
    const val = el.querySelector('.osc-in-ep-val');
    if (list) {
      list.innerHTML = slot.messages
        .filter(matches)
        .slice()
        .reverse()
        .map((m) => `<li><span>${escapeHtml(fmtArgs(m.args) || '—')}</span><em>${escapeHtml(sourceLabel(m.from))}</em></li>`)
        .join('');
    }
    const last = slot.messages.filter(matches).at(-1);
    if (val && last) val.textContent = fmtArgs(last.args) || '—';
  }

  function visibleSources() {
    return (getInSources() || []).filter((s) => !fromFilter.size || fromFilter.has(s.from));
  }

  function renderCompact() {
    const root = $('#osc-in-compact');
    if (!root) return;
    const sources = visibleSources();
    if (!sources.length) {
      root.innerHTML = '<p class="osc-in-muted">No incoming OSC yet</p>';
      return;
    }
    root.innerHTML = sources
      .map((src) => {
        const group = bySource.get(src.from) || { open: true, endpoints: new Map() };
        const addrs = [...group.endpoints.keys()]
          .filter((address) => group.endpoints.get(address).messages.some(matches))
          .sort();
        const srcOpen = group.open !== false;
        return `<section class="osc-in-src ${srcOpen ? '' : 'folded'}" data-from="${escapeAttr(src.from)}">
          <div class="osc-in-src-head">
            <button type="button" class="osc-in-src-fold" data-src-fold="${escapeAttr(src.from)}" aria-label="Toggle endpoints">▾</button>
            <span class="osc-in-src-name">${escapeHtml(src.name || src.from)}</span>
          </div>
          <div class="osc-in-src-eps">${
            addrs.length
              ? addrs
                  .map((address) => {
                    const slot = group.endpoints.get(address);
                    const last = slot.messages.filter(matches).at(-1);
                    const open = !!slot.open;
                    return `<section class="osc-in-ep ${open ? '' : 'folded'}" data-from="${escapeAttr(src.from)}" data-addr="${escapeAttr(address)}">
                      <button type="button" class="osc-in-ep-head" data-fold-from="${escapeAttr(src.from)}" data-fold="${escapeAttr(address)}">
                        <span class="osc-in-ep-name">${escapeHtml(address)}</span>
                        <span class="osc-in-ep-val">${escapeHtml(last ? fmtArgs(last.args) : '—')}</span>
                        <span class="osc-in-ep-caret">▾</span>
                      </button>
                      <div class="osc-in-ep-body">
                        <ul class="osc-in-msg-list">${slot.messages
                          .filter(matches)
                          .slice()
                          .reverse()
                          .map((m) => `<li><span>${escapeHtml(fmtArgs(m.args) || '—')}</span><em>${escapeHtml(sourceLabel(m.from))}</em></li>`)
                          .join('')}</ul>
                        <canvas class="osc-in-chart" data-from="${escapeAttr(src.from)}" data-chart="${escapeAttr(address)}"></canvas>
                      </div>
                    </section>`;
                  })
                  .join('')
              : '<p class="osc-in-muted">No endpoints yet</p>'
          }</div>
        </section>`;
      })
      .join('');

    root.querySelectorAll('[data-src-fold]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const from = btn.dataset.srcFold;
        let group = bySource.get(from);
        if (!group) {
          group = { open: true, endpoints: new Map() };
          bySource.set(from, group);
        }
        group.open = group.open === false;
        btn.closest('.osc-in-src')?.classList.toggle('folded', !group.open);
      });
    });
    root.querySelectorAll('[data-fold]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = bySource.get(btn.dataset.foldFrom)?.endpoints.get(btn.dataset.fold);
        if (!slot) return;
        slot.open = !slot.open;
        btn.parentElement?.classList.toggle('folded', !slot.open);
      });
    });
    drawCharts();
  }

  function renderRaw() {
    const pre = $('#osc-in-raw');
    if (!pre) return;
    pre.textContent = log.filter(matches).map(fmtLine).join('\n') + (log.length ? '\n' : '');
    pre.scrollTop = pre.scrollHeight;
  }

  function render() {
    bumpBadge();
    if (dock.dataset.mode === 'raw') renderRaw();
    else renderCompact();
  }

  function drawCharts() {
    const now = performance.now();
    $('#osc-in-compact')
      ?.querySelectorAll('canvas[data-chart]')
      .forEach((canvas) => {
        const slot = bySource.get(canvas.dataset.from)?.endpoints.get(canvas.dataset.chart);
        if (!slot) return;
        drawSpark(canvas, slot.samples, now);
      });
  }

  function startCharts() {
    stopCharts();
    drawCharts();
    chartTimer = setInterval(drawCharts, 80);
  }

  function stopCharts() {
    if (chartTimer) {
      clearInterval(chartTimer);
      chartTimer = null;
    }
  }

  return { push, render, renderSources: renderFromChips };
}

function drawSpark(canvas, samples, now) {
  if (!canvas || canvas.clientWidth < 8) return;
  const dpr = devicePixelRatio || 1;
  const w = (canvas.width = canvas.clientWidth * dpr);
  const h = (canvas.height = Math.max(48, canvas.clientHeight) * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, h);
  const windowMs = CHART_WINDOW_MS;
  const t0 = now - windowMs;
  const inW = (samples || []).filter((s) => s.t >= t0 - 500);
  if (inW.length < 2) return;
  let min = Math.min(...inW.map((s) => s.v));
  let max = Math.max(...inW.map((s) => s.v));
  if (max === min) {
    min -= 0.5;
    max += 0.5;
  }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  ctx.strokeStyle = 'rgb(255, 140, 0)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  inW.forEach((s, i) => {
    const x = ((s.t - t0) / windowMs) * w;
    const y = (1 - (s.v - min) / (max - min || 1)) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

