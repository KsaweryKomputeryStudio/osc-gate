import { DualSenseDevice, normalizeStick, normalizeTrigger } from './dualsense.js';
import { OscBridge, applyOscControl } from './oscBridge.js';

const TOUCHPAD_W = 1920;
const TOUCHPAD_H = 1080;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let controller = null;
let reportCount = 0;
let lastReportTime = performance.now();
let hz = 0;
let motionHistory = { gyroX: [], gyroY: [], gyroZ: [] };
const HISTORY_LEN = 120;

let oscBridge = null;

const stickCanvases = {
  left: { canvas: $('#stick-left'), ctx: null },
  right: { canvas: $('#stick-right'), ctx: null },
};

function init() {
  stickCanvases.left.ctx = stickCanvases.left.canvas.getContext('2d');
  stickCanvases.right.ctx = stickCanvases.right.canvas.getContext('2d');
  drawStick(stickCanvases.left.ctx, stickCanvases.left.canvas, 0, 0);
  drawStick(stickCanvases.right.ctx, stickCanvases.right.canvas, 0, 0);

  if (!('hid' in navigator)) {
    $('#webhid-warning').classList.remove('hidden');
    $('#connect-btn').disabled = true;
  }

  $('#connect-btn').addEventListener('click', connect);
  $('#disconnect-btn').addEventListener('click', disconnect);

  setupOutputControls();
  setupFeatureReports();
  setupOscUi();
  checkExistingDevices();

  navigator.hid?.addEventListener('connect', checkExistingDevices);
  navigator.hid?.addEventListener('disconnect', onHidDisconnect);
}

const OSC_STORAGE_KEY = 'dualsense-osc-config';

function loadOscConfig() {
  try {
    const raw = localStorage.getItem(OSC_STORAGE_KEY);
    if (!raw) {
      return { host: '127.0.0.1', port: 9000, wsUrl: 'ws://127.0.0.1:8081', hz: 60, ignoreAccel: false };
    }
    const parsed = JSON.parse(raw);
    return {
      host: parsed.host || '127.0.0.1',
      port: Number(parsed.port) || 9000,
      wsUrl: parsed.wsUrl || 'ws://127.0.0.1:8081',
      hz: Number(parsed.hz) || 60,
      ignoreAccel: !!parsed.ignoreAccel,
    };
  } catch {
    return { host: '127.0.0.1', port: 9000, wsUrl: 'ws://127.0.0.1:8081', hz: 60, ignoreAccel: false };
  }
}

function saveOscConfig({ host, port, wsUrl, hz, ignoreAccel }) {
  localStorage.setItem(
    OSC_STORAGE_KEY,
    JSON.stringify({
      host,
      port: Number(port),
      wsUrl: wsUrl || $('#osc-ws-url')?.value || 'ws://127.0.0.1:8081',
      hz: Number(hz) || 60,
      ignoreAccel: !!ignoreAccel,
    }),
  );
}

function getOscIgnoreAccel() {
  return !!($('#osc-modal-ignore-accel')?.checked || $('#osc-ignore-accel')?.checked);
}

function syncOscIgnoreAccelCheckboxes(checked) {
  if ($('#osc-modal-ignore-accel')) $('#osc-modal-ignore-accel').checked = checked;
  if ($('#osc-ignore-accel')) $('#osc-ignore-accel').checked = checked;
}

function applyOscOptions() {
  const ignoreAccel = getOscIgnoreAccel();
  const hz = Number($('#osc-modal-hz')?.value || 60);
  saveOscConfig({
    ...getOscDestination(),
    wsUrl: $('#osc-ws-url')?.value,
    hz,
    ignoreAccel,
  });
  oscBridge?.setIgnoreAccel(ignoreAccel);
  oscBridge?.setHz(hz);
  return ignoreAccel;
}

function isValidHost(host) {
  if (!host || host.length > 253) return false;
  // IPv4, hostname, or localhost
  return /^(?:(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/.test(
    host,
  );
}

function isValidPort(port) {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function getOscDestination() {
  return {
    host: ($('#osc-out-host')?.value || '127.0.0.1').trim(),
    port: Number($('#osc-out-port')?.value || 9000),
  };
}

function setOscDestinationFields(host, port, { syncModal = true, syncTab = true } = {}) {
  if (syncTab) {
    if ($('#osc-out-host')) $('#osc-out-host').value = host;
    if ($('#osc-out-port')) $('#osc-out-port').value = String(port);
  }
  if (syncModal) {
    if ($('#osc-modal-host')) $('#osc-modal-host').value = host;
    if ($('#osc-modal-port')) $('#osc-modal-port').value = String(port);
  }
  updateOscDestLabel(host, port);
  updateOscModalPreview();
}

function updateOscDestLabel(host, port) {
  const el = $('#osc-dest-label');
  if (el) el.textContent = `${host}:${port}`;
  const display = $('#osc-dest-display');
  if (display) display.value = `udp://${host}:${port}`;
}

function updateOscModalPreview() {
  const host = ($('#osc-modal-host')?.value || '127.0.0.1').trim() || '127.0.0.1';
  const port = $('#osc-modal-port')?.value || '9000';
  const preview = $('#osc-modal-preview');
  if (preview) preview.textContent = `udp://${host}:${port}`;
}

function applyOscDestination(host, port) {
  const h = String(host).trim();
  const p = Number(port);
  const hz = Number($('#osc-modal-hz')?.value || 60);
  const err = $('#osc-modal-error');

  if (!isValidHost(h) || !isValidPort(p)) {
    if (err) {
      err.textContent = 'Enter a valid IP/hostname and port (1–65535).';
      err.classList.remove('hidden');
    }
    return false;
  }

  if (err) err.classList.add('hidden');
  setOscDestinationFields(h, p);
  saveOscConfig({ host: h, port: p, wsUrl: $('#osc-ws-url')?.value, hz, ignoreAccel: getOscIgnoreAccel() });
  oscBridge?.setDestination(h, p);
  applyOscOptions();
  return true;
}

function openOscConfigModal() {
  const { host, port } = getOscDestination();
  setOscDestinationFields(host, port);
  $('#osc-modal-error')?.classList.add('hidden');
  $('#osc-config-modal')?.classList.remove('hidden');
  $('#osc-modal-host')?.focus();
}

function closeOscConfigModal() {
  $('#osc-config-modal')?.classList.add('hidden');
}

function setupOscUi() {
  const saved = loadOscConfig();
  setOscDestinationFields(saved.host, saved.port);
  if ($('#osc-ws-url')) $('#osc-ws-url').value = saved.wsUrl;
  if ($('#osc-modal-hz')) $('#osc-modal-hz').value = String(saved.hz || 60);
  syncOscIgnoreAccelCheckboxes(saved.ignoreAccel);

  $('#osc-config-open')?.addEventListener('click', openOscConfigModal);
  $('#osc-config-open-tab')?.addEventListener('click', openOscConfigModal);

  const onIgnoreAccelChange = (e) => {
    syncOscIgnoreAccelCheckboxes(e.target.checked);
    applyOscOptions();
  };
  $('#osc-modal-ignore-accel')?.addEventListener('change', onIgnoreAccelChange);
  $('#osc-ignore-accel')?.addEventListener('change', onIgnoreAccelChange);

  $$('[data-close-osc-modal]').forEach((el) => {
    el.addEventListener('click', closeOscConfigModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#osc-config-modal')?.classList.contains('hidden')) {
      closeOscConfigModal();
    }
  });

  $('#osc-modal-host')?.addEventListener('input', updateOscModalPreview);
  $('#osc-modal-port')?.addEventListener('input', updateOscModalPreview);

  $$('[data-osc-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [host, port] = btn.dataset.oscPreset.split(':');
      setOscDestinationFields(host, port, { syncTab: false });
      $('#osc-modal-error')?.classList.add('hidden');
    });
  });

  $('#osc-modal-apply')?.addEventListener('click', () => {
    const ok = applyOscDestination($('#osc-modal-host').value, $('#osc-modal-port').value);
    if (ok) closeOscConfigModal();
  });

  $('#osc-modal-host')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#osc-modal-apply')?.click();
  });
  $('#osc-modal-port')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#osc-modal-apply')?.click();
  });

  $('#osc-connect-btn').addEventListener('click', () => {
    const url = $('#osc-ws-url').value.trim() || 'ws://127.0.0.1:8081';
    if (oscBridge) oscBridge.disconnect();

    oscBridge = new OscBridge({
      wsUrl: url,
      hz: Number($('#osc-modal-hz')?.value || saved.hz || 60),
      onStatus: updateOscStatus,
      onControl: (address, args) => {
        const handled = applyOscControl(controller, address, args);
        const argStr = args.map((a) => (typeof a === 'object' ? a.value : a)).join(' ');
        $('#osc-last').textContent = handled
          ? `${address} ${argStr}`
          : `${address} (unhandled)`;
        if (handled) syncOutputUiFromController();
      },
    });

    const { host, port } = getOscDestination();
    const hz = Number($('#osc-modal-hz')?.value || 60);
    saveOscConfig({ host, port, wsUrl: url, hz, ignoreAccel: getOscIgnoreAccel() });
    oscBridge.setDestination(host, port);
    oscBridge.setHz(hz);
    oscBridge.setIgnoreAccel(getOscIgnoreAccel());
    oscBridge.connect();
    $('#osc-enable').disabled = false;
    $('#osc-disconnect-btn').disabled = false;
    $('#osc-connect-btn').disabled = true;
  });

  $('#osc-disconnect-btn').addEventListener('click', () => {
    oscBridge?.disconnect();
    oscBridge = null;
    $('#osc-enable').checked = false;
    $('#osc-enable').disabled = true;
    $('#osc-disconnect-btn').disabled = true;
    $('#osc-connect-btn').disabled = false;
    updateOscStatus({ connected: false, enabled: false });
  });

  $('#osc-enable').addEventListener('change', (e) => {
    oscBridge?.setEnabled(e.target.checked);
  });

  setInterval(() => {
    if (!oscBridge) return;
    $('#osc-sent').textContent = String(oscBridge.stats.sentBundles);
    $('#osc-recv').textContent = String(oscBridge.stats.recvMessages);
  }, 500);
}

function updateOscStatus({ connected, enabled, oscIn, error }) {
  const parts = [];
  if (error) parts.push(`error: ${error}`);
  else parts.push(connected ? 'online' : 'offline');
  if (enabled) parts.push('streaming');
  $('#osc-status').textContent = parts.join(' · ');
  if (oscIn?.port) {
    $('#osc-in-port').textContent = `udp://0.0.0.0:${oscIn.port}`;
  }
  const { host, port } = getOscDestination();
  updateOscDestLabel(host, port);
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
  if (controller) return;
  const devices = await navigator.hid.getDevices();
  for (const device of devices) {
    if (DualSenseDevice.isDualSense(device)) {
      await openDevice(device);
      return;
    }
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
}

function updateConnectionUI(connected) {
  $('#connect-btn').disabled = connected;
  $('#disconnect-btn').disabled = !connected;
  const dot = $('#status-dot');
  dot.classList.toggle('connected', connected);
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

  ctx.strokeStyle = '#2a3142';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#1a1f2a';
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  const px = cx + x * radius * 0.85;
  const py = cy + y * radius * 0.85;

  ctx.fillStyle = 'rgba(0, 112, 243, 0.25)';
  ctx.beginPath();
  ctx.arc(px, py, radius * 0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0070f3';
  ctx.beginPath();
  ctx.arc(px, py, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function updateTouchpad(touches) {
  const canvas = $('#touchpad-canvas');
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);

  ctx.fillStyle = '#1e2430';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#2a3142';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  if (!touches) {
    $('#touch0-info').textContent = 'Touch 1: —';
    $('#touch1-info').textContent = 'Touch 2: —';
    return;
  }

  const colors = ['#0070f3', '#22c55e'];
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

  ctx.strokeStyle = '#0070f3';
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
});
