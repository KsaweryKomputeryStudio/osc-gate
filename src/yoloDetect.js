/**
 * YOLOv8n (COCO) in the browser via ONNX Runtime Web.
 * Counts class 0 (person) after confidence filter + NMS.
 */

import * as ort from 'onnxruntime-web';

const INPUT = 640;
const PERSON = 0;
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.1/dist/';

const MODEL_URLS = [
  '/models/yolov8n.onnx',
  'https://cdn.jsdelivr.net/gh/Hyuto/yolov8-onnxruntime-web@master/public/model/yolov8n.onnx',
];

let sessionPromise = null;

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

function nms(boxes, iouThresh) {
  const sorted = boxes.slice().sort((a, b) => b.score - a.score);
  const keep = [];
  for (const box of sorted) {
    if (keep.every((k) => iou(box, k) < iouThresh)) keep.push(box);
  }
  return keep;
}

function letterbox(video, canvas) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  canvas.width = INPUT;
  canvas.height = INPUT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#727272';
  ctx.fillRect(0, 0, INPUT, INPUT);
  const scale = Math.min(INPUT / vw, INPUT / vh);
  const nw = vw * scale;
  const nh = vh * scale;
  const padX = (INPUT - nw) / 2;
  const padY = (INPUT - nh) / 2;
  ctx.drawImage(video, padX, padY, nw, nh);
  const { data } = ctx.getImageData(0, 0, INPUT, INPUT);
  const tensor = new Float32Array(3 * INPUT * INPUT);
  const plane = INPUT * INPUT;
  for (let i = 0; i < plane; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[plane + i] = data[i * 4 + 1] / 255;
    tensor[plane * 2 + i] = data[i * 4 + 2] / 255;
  }
  return { tensor, scale, padX, padY, vw, vh };
}

function parseOutput(output, conf, meta) {
  const dims = output.dims;
  const data = output.data;
  const transposed = dims.length === 3 && dims[1] < dims[2];
  const num = transposed ? dims[2] : dims[1];
  const stride = transposed ? dims[2] : dims[2];
  const get = (ch, i) => (transposed ? data[ch * num + i] : data[i * stride + ch]);

  const { scale, padX, padY, vw, vh } = meta;
  const boxes = [];
  for (let i = 0; i < num; i++) {
    const score = get(4 + PERSON, i);
    if (score < conf) continue;
    const cx = get(0, i);
    const cy = get(1, i);
    const w = get(2, i);
    const h = get(3, i);
    const x1 = (cx - w / 2 - padX) / scale;
    const y1 = (cy - h / 2 - padY) / scale;
    const x2 = (cx + w / 2 - padX) / scale;
    const y2 = (cy + h / 2 - padY) / scale;
    boxes.push({
      x1: Math.max(0, x1),
      y1: Math.max(0, y1),
      x2: Math.min(vw, x2),
      y2: Math.min(vh, y2),
      score,
    });
  }
  return boxes;
}

async function fetchModel() {
  let lastErr;
  for (const url of MODEL_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.arrayBuffer();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not download YOLOv8n');
}

export async function loadYolo({ onProgress } = {}) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    onProgress?.('Loading YOLOv8n…');
    ort.env.wasm.wasmPaths = WASM_PATH;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    const buf = await fetchModel();
    onProgress?.('Starting model…');
    return ort.InferenceSession.create(buf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  })();
  try {
    return await sessionPromise;
  } catch (err) {
    sessionPromise = null;
    throw err;
  }
}

export async function detectPersons(session, video, canvas, { confidence = 0.35, iou = 0.45 } = {}) {
  const meta = letterbox(video, canvas);
  if (!meta) return [];
  const input = new ort.Tensor('float32', meta.tensor, [1, 3, INPUT, INPUT]);
  const feeds = { [session.inputNames[0]]: input };
  const out = await session.run(feeds);
  const first = out[session.outputNames[0]];
  return nms(parseOutput(first, confidence, meta), iou);
}
