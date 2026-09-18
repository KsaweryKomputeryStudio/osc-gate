/**
 * MediaPipe Gesture Recognizer — left/right hand landmarks + canned gestures.
 * Values are 0–1. Preview draws the 21-point skeleton.
 */

const MP_VERSION = '0.10.32';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export const HAND_SIDES = ['left', 'right'];

export const GESTURE_KEYS = [
  { id: 'fist', mediapipe: 'Closed_Fist', label: 'Fist' },
  { id: 'open', mediapipe: 'Open_Palm', label: 'Open' },
  { id: 'point', mediapipe: 'Pointing_Up', label: 'Point' },
  { id: 'thumb_up', mediapipe: 'Thumb_Up', label: 'Thumb+' },
  { id: 'thumb_down', mediapipe: 'Thumb_Down', label: 'Thumb−' },
  { id: 'victory', mediapipe: 'Victory', label: 'Victory' },
  { id: 'love', mediapipe: 'ILoveYou', label: 'Love' },
];

export const FINGERS = [
  { id: 'thumb', tip: 4, label: 'Thumb' },
  { id: 'index', tip: 8, label: 'Index' },
  { id: 'middle', tip: 12, label: 'Middle' },
  { id: 'ring', tip: 16, label: 'Ring' },
  { id: 'pinky', tip: 20, label: 'Pinky' },
];

export const HAND_HUD_KEYS = [
  { id: 'present', label: 'Present' },
  { id: 'x', label: 'X' },
  { id: 'y', label: 'Y' },
  { id: 'pinch', label: 'Pinch' },
  { id: 'grab', label: 'Grab' },
  { id: 'spread', label: 'Spread' },
];

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

const LEFT_COLOR = 'rgb(255, 140, 0)';
const RIGHT_COLOR = 'rgb(255, 210, 120)';

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function round3(v) {
  return Math.round(clamp01(v) * 1000) / 1000;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function emptyGestures() {
  const g = {};
  for (const row of GESTURE_KEYS) g[row.id] = 0;
  return g;
}

export function emptyHand() {
  const fingers = {};
  for (const f of FINGERS) fingers[f.id] = { x: 0, y: 0 };
  return {
    present: 0,
    score: 0,
    x: 0,
    y: 0,
    pinch: 0,
    grab: 0,
    spread: 0,
    fingers,
    gestures: emptyGestures(),
    gesture: '',
    gestureScore: 0,
    landmarks: [],
  };
}

export function emptyHandsSample() {
  return { left: emptyHand(), right: emptyHand() };
}

export function handsSignalRows() {
  const rows = [];
  for (const side of HAND_SIDES) {
    const L = side === 'left' ? 'Left' : 'Right';
    rows.push(
      { key: `${side}/present`, label: `${L} present` },
      { key: `${side}/score`, label: `${L} score` },
      { key: `${side}/x`, label: `${L} X` },
      { key: `${side}/y`, label: `${L} Y` },
      { key: `${side}/pinch`, label: `${L} pinch` },
      { key: `${side}/grab`, label: `${L} grab` },
      { key: `${side}/spread`, label: `${L} spread` },
    );
    for (const f of FINGERS) {
      rows.push(
        { key: `${side}/${f.id}/x`, label: `${L} ${f.label} X` },
        { key: `${side}/${f.id}/y`, label: `${L} ${f.label} Y` },
      );
    }
    for (const g of GESTURE_KEYS) {
      rows.push({ key: `${side}/gesture/${g.id}`, label: `${L} ${g.label}` });
    }
  }
  return rows;
}

export function flattenHands(sample) {
  const values = {};
  for (const side of HAND_SIDES) {
    const h = sample?.[side] || emptyHand();
    values[`${side}/present`] = h.present;
    values[`${side}/score`] = h.score;
    values[`${side}/x`] = h.x;
    values[`${side}/y`] = h.y;
    values[`${side}/pinch`] = h.pinch;
    values[`${side}/grab`] = h.grab;
    values[`${side}/spread`] = h.spread;
    for (const f of FINGERS) {
      values[`${side}/${f.id}/x`] = h.fingers[f.id]?.x || 0;
      values[`${side}/${f.id}/y`] = h.fingers[f.id]?.y || 0;
    }
    for (const g of GESTURE_KEYS) {
      values[`${side}/gesture/${g.id}`] = h.gestures[g.id] || 0;
    }
  }
  return values;
}

function mapX(x, mirror) {
  return round3(mirror ? 1 - x : x);
}

function previewPt(p, mirror) {
  return { x: mirror ? 1 - p.x : p.x, y: p.y };
}

/** Fingertip in a hand-local frame: 0.5 = palm, y > 0.5 toward fingers, x > 0.5 to the preview-right of the hand. */
function fingerRelative(lm, tipIndex, mirror) {
  const wrist = previewPt(lm[0], mirror);
  const mcp = previewPt(lm[9], mirror);
  const palm = previewPt(palmOf(lm), mirror);
  const tip = previewPt(lm[tipIndex], mirror);
  let ux = mcp.x - wrist.x;
  let uy = mcp.y - wrist.y;
  const span = Math.hypot(ux, uy) || 1e-6;
  ux /= span;
  uy /= span;
  const rx = -uy;
  const ry = ux;
  const dx = tip.x - palm.x;
  const dy = tip.y - palm.y;
  const localX = (dx * rx + dy * ry) / span;
  const localY = (dx * ux + dy * uy) / span;
  const range = 1.8;
  return {
    x: round3(localX / (2 * range) + 0.5),
    y: round3(localY / (2 * range) + 0.5),
  };
}

function pinchOf(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6;
  return round3(1 - dist(lm[4], lm[8]) / (palm * 1.15));
}

function grabOf(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6;
  const curls = [
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17],
  ].map(([tip, mcp]) => clamp01(1 - dist(lm[tip], lm[mcp]) / (palm * 1.45)));
  return round3(curls.reduce((a, b) => a + b, 0) / curls.length);
}

function spreadOf(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6;
  return round3(dist(lm[5], lm[17]) / (palm * 1.65));
}

function palmOf(lm) {
  return {
    x: (lm[0].x + lm[5].x + lm[17].x) / 3,
    y: (lm[0].y + lm[5].y + lm[17].y) / 3,
  };
}

function recognizerRuntimeOptions(confidence = 0.5) {
  const c = Math.min(0.9, Math.max(0.15, Number(confidence) || 0.5));
  return {
    numHands: 2,
    minHandDetectionConfidence: c,
    minHandPresenceConfidence: c,
    minTrackingConfidence: c,
  };
}

function assignDetectedHands(result, { mirror, fingersRelative } = {}) {
  const sample = emptyHandsSample();
  const n = result?.landmarks?.length || 0;
  const detected = [];
  for (let i = 0; i < n; i++) {
    const lm = result.landmarks[i];
    if (!lm?.length) continue;
    const handed = result.handedness?.[i]?.[0] || result.handednesses?.[i]?.[0];
    const name = String(handed?.categoryName || '').toLowerCase();
    const palm = palmOf(lm);
    detected.push({
      i,
      lm,
      handed,
      gestures: result.gestures?.[i],
      label: name === 'right' ? 'right' : name === 'left' ? 'left' : '',
      previewX: mirror ? 1 - palm.x : palm.x,
      score: Number(handed?.score) || 0,
    });
  }
  if (!detected.length) return sample;

  const fill = (side, d) => {
    if (!d) return;
    sample[side] = handFromLandmarks(d.lm, d.handed, d.gestures, { mirror, fingersRelative });
  };

  if (detected.length === 1) {
    const d = detected[0];
    fill(d.label || (d.previewX < 0.5 ? 'left' : 'right'), d);
    return sample;
  }

  const byScore = (a, b) => b.score - a.score;
  const lefts = detected.filter((d) => d.label === 'left').sort(byScore);
  const rights = detected.filter((d) => d.label === 'right').sort(byScore);
  if (lefts[0] && rights[0] && lefts[0].i !== rights[0].i) {
    fill('left', lefts[0]);
    fill('right', rights[0]);
    return sample;
  }

  const ordered = detected.slice().sort((a, b) => a.previewX - b.previewX);
  fill('left', ordered[0]);
  fill('right', ordered[ordered.length - 1]);
  return sample;
}

function parseGestures(categories) {
  const gestures = emptyGestures();
  let gesture = '';
  let gestureScore = 0;
  for (const cat of categories || []) {
    const name = String(cat?.categoryName || '');
    const score = round3(cat?.score);
    if (!name || name === 'None' || name === 'Unidentified') continue;
    const row = GESTURE_KEYS.find((g) => g.mediapipe === name);
    if (!row) continue;
    gestures[row.id] = Math.max(gestures[row.id], score);
    if (score > gestureScore) {
      gesture = row.id;
      gestureScore = score;
    }
  }
  return { gestures, gesture, gestureScore };
}

function handFromLandmarks(lm, handedness, categories, { mirror = true, fingersRelative = false } = {}) {
  const palm = palmOf(lm);
  const { gestures, gesture, gestureScore } = parseGestures(categories);
  const score = round3(handedness?.score);
  const fingers = {};
  for (const f of FINGERS) {
    fingers[f.id] = fingersRelative
      ? fingerRelative(lm, f.tip, mirror)
      : { x: mapX(lm[f.tip].x, mirror), y: round3(lm[f.tip].y) };
  }
  return {
    present: 1,
    score,
    x: mapX(palm.x, mirror),
    y: round3(palm.y),
    pinch: pinchOf(lm),
    grab: grabOf(lm),
    spread: spreadOf(lm),
    fingers,
    gestures,
    gesture,
    gestureScore,
    landmarks: lm,
  };
}

let recognizerPromise = null;

async function createRecognizer(onProgress) {
  onProgress?.('Loading MediaPipe…');
  const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
  onProgress?.('Loading hand model…');
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    ...recognizerRuntimeOptions(0.5),
  };
  try {
    return await GestureRecognizer.createFromOptions(vision, options);
  } catch {
    onProgress?.('MediaPipe GPU unavailable — using CPU…');
    return GestureRecognizer.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' },
    });
  }
}

function loadRecognizer(onProgress) {
  if (!recognizerPromise) {
    recognizerPromise = createRecognizer(onProgress).catch((err) => {
      recognizerPromise = null;
      throw err;
    });
  }
  return recognizerPromise;
}

export class HandsSource {
  constructor({ video, overlay, onSample, onStatus } = {}) {
    this.video = video;
    this.overlay = overlay;
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.connected = false;
    this.deviceId = '';
    this.deviceLabel = '';
    this.confidence = 0.5;
    this.mirror = true;
    this.fingersRelative = false;

    this._stream = null;
    this._recognizer = null;
    this._loop = false;
    this._busy = false;
    this._lastTs = 0;
    this._sample = emptyHandsSample();
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  setOptions({ confidence, mirror, fingersRelative } = {}) {
    if (confidence != null) {
      this.confidence = Math.min(0.9, Math.max(0.15, Number(confidence) || 0.5));
      this._recognizer
        ?.setOptions?.({
          ...recognizerRuntimeOptions(this.confidence),
        })
        .catch(() => {});
    }
    if (mirror != null) {
      this.mirror = !!mirror;
      this.video?.classList.toggle('mirror', this.mirror);
    }
    if (fingersRelative != null) this.fingersRelative = !!fingersRelative;
  }

  async listDevices() {
    if (!HandsSource.isSupported()) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({
        id: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
  }

  async connect(deviceId = '') {
    if (!HandsSource.isSupported()) throw new Error('Camera is not available in this browser');
    await this.disconnect();
    this.onStatus({ connecting: true, connected: false, message: 'Starting camera…' });

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this._stream = stream;
    const track = stream.getVideoTracks()[0];
    this.deviceId = track?.getSettings?.().deviceId || deviceId || '';
    this.deviceLabel = track?.label || 'Camera';

    this.onStatus({
      connecting: true,
      connected: false,
      preview: true,
      name: this.deviceLabel,
      message: 'Starting camera…',
    });
    await this._attachStream(stream);
    this._recognizer = await loadRecognizer((message) =>
      this.onStatus({
        connecting: true,
        connected: false,
        preview: true,
        name: this.deviceLabel,
        message,
      }),
    );
    await this._recognizer.setOptions(recognizerRuntimeOptions(this.confidence));

    this.connected = true;
    this._loop = true;
    this._lastTs = 0;
    this.onStatus({ connected: true, connecting: false, name: this.deviceLabel, deviceId: this.deviceId });
    this._tick();
    return { deviceId: this.deviceId, label: this.deviceLabel };
  }

  async disconnect() {
    this._loop = false;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    if (this.video) this.video.srcObject = null;
    this._clearOverlay();
    const was = this.connected;
    this.connected = false;
    this._sample = emptyHandsSample();
    this.video?.classList.remove('mirror');
    if (was) this.onStatus({ connected: false, connecting: false });
  }

  async _attachStream(stream) {
    if (!this.video) return;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
  }

  _clearOverlay() {
    const c = this.overlay;
    if (!c) return;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  _draw(sample) {
    const video = this.video;
    const canvas = this.overlay;
    if (!video || !canvas || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    this.video.classList.toggle('mirror', this.mirror);
    const line = Math.max(2, Math.round(w / 420));
    const radius = Math.max(3, Math.round(w / 160));
    for (const side of HAND_SIDES) {
      const hand = sample[side];
      if (!hand?.present || !hand.landmarks?.length) continue;
      drawSkeleton(
        ctx,
        hand.landmarks,
        w,
        h,
        side === 'left' ? LEFT_COLOR : RIGHT_COLOR,
        line,
        radius,
        side,
        this.mirror,
      );
    }
  }

  _tick = () => {
    if (!this._loop || !this.connected) return;
    if (this._busy || !this.video?.videoWidth || !this._recognizer) {
      requestAnimationFrame(this._tick);
      return;
    }
    this._busy = true;
    try {
      let ts = performance.now();
      if (ts <= this._lastTs) ts = this._lastTs + 1;
      this._lastTs = ts;
      const result = this._recognizer.recognizeForVideo(this.video, ts);
      const sample = assignDetectedHands(result, {
        mirror: this.mirror,
        fingersRelative: this.fingersRelative,
      });
      this._sample = sample;
      this._draw(sample);
      this.onSample({ ...sample, name: this.deviceLabel, mirror: this.mirror });
    } catch (err) {
      this.onStatus({ connected: true, error: err.message });
    } finally {
      this._busy = false;
      if (this._loop) requestAnimationFrame(this._tick);
    }
  };
}

function drawSkeleton(ctx, lm, w, h, color, line, radius, side, mirror) {
  const xOf = (p) => (mirror ? 1 - p.x : p.x) * w;
  const yOf = (p) => p.y * h;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = lm[a];
    const pb = lm[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(xOf(pa), yOf(pa));
    ctx.lineTo(xOf(pb), yOf(pb));
    ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    const p = lm[i];
    ctx.beginPath();
    ctx.arc(xOf(p), yOf(p), i === 0 ? radius + 1 : radius, 0, Math.PI * 2);
    ctx.fill();
  }
  const palm = palmOf(lm);
  const label = side === 'left' ? 'L' : 'R';
  ctx.font = `700 ${Math.max(14, Math.round(w / 28))}px ui-sans-serif, system-ui`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(3, line);
  ctx.strokeStyle = '#000';
  ctx.strokeText(label, xOf(palm), yOf(palm) - radius * 4);
  ctx.fillStyle = color;
  ctx.fillText(label, xOf(palm), yOf(palm) - radius * 4);
}
