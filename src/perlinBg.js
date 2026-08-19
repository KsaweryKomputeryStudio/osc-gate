/** Interphase-style thresholded Perlin field (orange). */
export function startPerlinBg(parentId = 'perlinBg', rgb = [255, 140, 0]) {
  const parent = document.getElementById(parentId);
  if (!parent) return;

  const canvas = document.createElement('canvas');
  parent.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  const perm = buildPermutation();
  const scale = 10;
  const noiseScale = 0.075;
  const threshold = 0.5;
  let z = 0;
  let off = null;
  let buffer = null;
  let bw = 0;
  let bh = 0;
  let raf = 0;
  let last = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    bw = Math.max(1, Math.floor(canvas.width / scale));
    bh = Math.max(1, Math.floor(canvas.height / scale));
    buffer = ctx.createImageData(bw, bh);
    if (!off) off = document.createElement('canvas');
    off.width = bw;
    off.height = bh;
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (ts - last < 1000 / 24) return;
    last = ts;
    if (!buffer || !off) return;

    const data = buffer.data;
    const [r, g, b] = rgb;
    let i = 0;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const n = noise3(perm, x * noiseScale, y * noiseScale, z);
        if (n >= threshold) {
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        } else {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
        data[i + 3] = 255;
        i += 4;
      }
    }
    const offCtx = off.getContext('2d');
    offCtx.putImageData(buffer, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    z += 0.006;
  }

  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + t * (b - a);
}

function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function noise3(p, x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = p[X] + Y;
  const AA = p[A] + Z;
  const AB = p[A + 1] + Z;
  const B = p[X + 1] + Y;
  const BA = p[B] + Z;
  const BB = p[B + 1] + Z;
  return (
    lerp(
      lerp(
        lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    ) *
      0.5 +
    0.5
  );
}

function buildPermutation() {
  const p = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  let s = 1337;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = source[i];
    source[i] = source[j];
    source[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = source[i & 255];
  return p;
}
