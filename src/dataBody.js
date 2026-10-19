/**
 * One 3D body of live OSC: clustered nodes, a mesh, and particles that
 * travel when values move.
 */

const MAX_NODES = 180;
const MAX_PARTICLES = 180;
const STALE_MS = 14_000;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fibonacci(i, n) {
  if (n <= 1) return { x: 0, y: 0, z: 0 };
  const y = 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const t = GOLDEN * i;
  return { x: Math.cos(t) * r, y, z: Math.sin(t) * r };
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function as01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n >= 0 && n <= 1) return n;
  if (n >= 0 && n <= 127) return n / 127;
  if (n >= 0 && n <= 255) return n / 255;
  return clamp01(Math.abs(n));
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function tintFor(id) {
  const h = hash32(id);
  const incoming = String(id).startsWith('in:');
  return {
    r: 255,
    g: incoming ? 170 + (h % 40) : 110 + (h % 55),
    b: incoming ? 40 + (h % 30) : h % 18,
  };
}

export function setupDataBody(canvas) {
  if (!canvas) return { push() {}, start() {}, stop() {}, resize() {}, stats: () => ({ nodes: 0, flow: 0 }) };

  const ctx = canvas.getContext('2d');
  const nodes = new Map();
  const particles = [];
  let edges = [];
  let running = false;
  let raf = 0;
  let last = 0;
  let rotY = 0.35;
  let rotX = 0.28;
  let userZoom = 1;
  let fitZoom = 1;
  let dragging = false;
  let lastPtr = null;
  let layoutDirty = true;
  let flow = 0;

  function keyOf(sourceId, address) {
    return `${sourceId}\0${address}`;
  }

  function push(sourceId, messages) {
    if (!sourceId || !messages?.length) return;
    const now = performance.now();
    for (const m of messages) {
      const address = m.address;
      if (!address) continue;
      const raw = Number(m.out ?? m.args?.[0]);
      if (!Number.isFinite(raw)) continue;
      const value = as01(raw);
      const key = keyOf(sourceId, address);
      let node = nodes.get(key);
      if (!node) {
        if (nodes.size >= MAX_NODES) {
          let oldest = null;
          let oldestT = Infinity;
          for (const n of nodes.values()) {
            if (n.seen < oldestT) {
              oldestT = n.seen;
              oldest = n;
            }
          }
          if (oldest) nodes.delete(oldest.key);
        }
        node = {
          key,
          sourceId,
          address,
          label: address.split('/').filter(Boolean).slice(-2).join('/'),
          value,
          smooth: value,
          prev: value,
          energy: 0.4,
          x: 0,
          y: 0,
          z: 0,
          rest: { x: 0, y: 0, z: 0 },
          tint: tintFor(sourceId),
          seen: now,
        };
        nodes.set(key, node);
        layoutDirty = true;
      }
      const delta = Math.abs(value - node.value);
      node.prev = node.value;
      node.value = value;
      node.seen = now;
      if (delta > 0.004) {
        node.energy = Math.min(1, node.energy + Math.min(0.85, delta * 5));
        flow = Math.min(1, flow + delta);
        spawnTravel(node, delta);
      }
    }
  }

  function spawnTravel(node, delta) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    const links = edges.filter((e) => e.a === node || e.b === node);
    if (!links.length) return;
    const edge = links[Math.floor(Math.random() * links.length)];
    const from = edge.a === node ? edge.a : edge.b;
    const to = edge.a === node ? edge.b : edge.a;
    const count = delta > 0.12 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      particles.push({
        from,
        to,
        t: -i * 0.12,
        speed: 0.9 + delta * 1.4 + Math.random() * 0.35,
        tint: node.tint,
      });
    }
  }

  function relayout() {
    const groups = new Map();
    for (const node of nodes.values()) {
      const list = groups.get(node.sourceId) || [];
      list.push(node);
      groups.set(node.sourceId, list);
    }
    const sources = [...groups.keys()].sort();
    const S = sources.length;
    sources.forEach((sid, si) => {
      const c = S <= 1 ? { x: 0, y: 0, z: 0 } : scale(fibonacci(si, S), 0.72);
      const list = groups.get(sid);
      list.sort((a, b) => a.address.localeCompare(b.address));
      list.forEach((node, ni) => {
        const local = scale(fibonacci(ni, list.length), 0.42 + 0.22 * node.smooth);
        node.rest = { x: c.x + local.x, y: c.y + local.y, z: c.z + local.z };
      });
    });
    edges = buildEdges(groups, sources);
    updateFit();
    layoutDirty = false;
  }

  function boundingRadius() {
    let max = 0.2;
    for (const node of nodes.values()) {
      const r = Math.hypot(node.rest.x, node.rest.y, node.rest.z);
      if (r > max) max = r;
    }
    return max + 0.06;
  }

  function updateFit() {
    if (!nodes.size) {
      fitZoom = 1;
      return;
    }
    const R = boundingRadius();
    const f = 2.35;
    const proj = 0.42;
    fitZoom = (0.75 * f) / (2 * R * proj);
    fitZoom = Math.max(0.8, Math.min(14, fitZoom));
  }

  function scale(p, s) {
    return { x: p.x * s, y: p.y * s, z: p.z * s };
  }

  function buildEdges(groups, sources) {
    const out = [];
    const add = (a, b, w) => {
      if (!a || !b || a === b) return;
      out.push({ a, b, w });
    };
    for (const list of groups.values()) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        let best = [];
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          best.push({ n: list[j], d: dist2(a.rest, list[j].rest) });
        }
        best.sort((x, y) => x.d - y.d);
        const k = Math.min(3, best.length);
        for (let n = 0; n < k; n++) add(a, best[n].n, 1);
      }
    }
    for (let i = 0; i < sources.length; i++) {
      const aList = groups.get(sources[i]);
      const bList = groups.get(sources[(i + 1) % sources.length]);
      if (!aList?.length || !bList?.length || aList === bList) continue;
      let pair = null;
      let best = Infinity;
      for (const a of aList) {
        for (const b of bList) {
          const d = dist2(a.rest, b.rest);
          if (d < best) {
            best = d;
            pair = [a, b];
          }
        }
      }
      if (pair) add(pair[0], pair[1], 0.55);
    }
    const seen = new Set();
    return out.filter((e) => {
      const k = e.a.key < e.b.key ? `${e.a.key}|${e.b.key}` : `${e.b.key}|${e.a.key}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function project(p, w, h) {
    const cy = Math.cos(rotY);
    const sy = Math.sin(rotY);
    const cx = Math.cos(rotX);
    const sx = Math.sin(rotX);
    const x1 = p.x * cy + p.z * sy;
    const z1 = -p.x * sy + p.z * cy;
    const y1 = p.y * cx - z1 * sx;
    const z2 = p.y * sx + z1 * cx;
    const f = 2.35;
    const s = (Math.min(w, h) * 0.42 * fitZoom * userZoom) / (f + z2);
    return { x: w * 0.5 + x1 * s, y: h * 0.52 + y1 * s, z: z2, s: Math.max(0.15, s) };
  }

  function prune(now) {
    for (const [key, node] of nodes) {
      if (now - node.seen > STALE_MS) {
        nodes.delete(key);
        layoutDirty = true;
      }
    }
  }

  function step(dt, now) {
    prune(now);
    if (layoutDirty) relayout();
    flow *= Math.pow(0.12, dt);
    const breath = 1 + flow * 0.06;
    for (const node of nodes.values()) {
      node.smooth += (node.value - node.smooth) * Math.min(1, dt * 7);
      node.energy *= Math.pow(0.12, dt);
      const rest = node.rest;
      const amp = 1 + node.energy * 0.12 + node.smooth * 0.04;
      const tx = rest.x * amp * breath;
      const ty = rest.y * amp * breath;
      const tz = rest.z * amp * breath;
      node.x += (tx - node.x) * Math.min(1, dt * 5);
      node.y += (ty - node.y) * Math.min(1, dt * 5);
      node.z += (tz - node.z) * Math.min(1, dt * 5);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt * p.speed;
      if (p.t >= 1) particles.splice(i, 1);
    }
  }

  function draw(w, h) {
    ctx.fillStyle = '#070707';
    ctx.fillRect(0, 0, w, h);
    if (!nodes.size) {
      ctx.fillStyle = 'rgba(255,140,0,0.45)';
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for live OSC…', w / 2, h / 2);
      return;
    }

    const projected = [];
    for (const node of nodes.values()) {
      projected.push({ node, p: project(node, w, h) });
    }

    for (const e of edges) {
      const a = project(e.a, w, h);
      const b = project(e.b, w, h);
      const en = Math.max(e.a.energy, e.b.energy);
      const depth = clamp01(1 - (a.z + b.z) * 0.18);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(255,140,0,${(0.07 + en * 0.35) * depth * e.w})`;
      ctx.lineWidth = 0.7 + en * 1.8;
      ctx.stroke();
    }

    projected.sort((a, b) => a.p.z - b.p.z);
    for (const { node, p } of projected) {
      const depth = clamp01(1 - p.z * 0.22);
      const r = (2.2 + node.smooth * 7 + node.energy * 5) * (0.35 + depth);
      const { r: cr, g, b } = node.tint;
      if (node.energy > 0.08) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (1.25 + node.energy * 0.25), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${g},${b},${0.14 + node.energy * 0.22})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${cr},${g},${b},${0.35 + node.smooth * 0.4 + node.energy * 0.25})`;
      ctx.fill();
    }

    for (const part of particles) {
      if (part.t < 0 || part.t > 1) continue;
      const x = part.from.x + (part.to.x - part.from.x) * part.t;
      const y = part.from.y + (part.to.y - part.from.y) * part.t;
      const z = part.from.z + (part.to.z - part.from.z) * part.t;
      const p = project({ x, y, z }, w, h);
      const { r, g, b } = part.tint;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2 + (1 - Math.abs(part.t - 0.5) * 2) * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
      ctx.fill();
    }

    const hot = projected
      .filter((row) => row.node.energy > 0.22 || row.node.smooth > 0.72)
      .sort((a, b) => b.node.energy - a.node.energy)
      .slice(0, 7);
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (const { node, p } of hot) {
      ctx.fillStyle = 'rgba(255,140,0,0.72)';
      ctx.fillText(node.label, p.x + 8, p.y - 6);
    }
  }

  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    step(dt, ts);
    draw(w, h);
    paintHud();
  }

  function paintHud() {
    const n = document.getElementById('databody-count');
    const f = document.getElementById('databody-flow');
    if (n) n.textContent = String(nodes.size);
    if (f) f.textContent = flow > 0.04 ? 'moving' : 'still';
  }

  function resize() {
    layoutDirty = true;
    updateFit();
  }

  function start() {
    if (!running) userZoom = 1;
    layoutDirty = true;
    updateFit();
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastPtr = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || !lastPtr) return;
    rotY += (e.clientX - lastPtr.x) * 0.005;
    rotX = Math.max(-1.2, Math.min(1.2, rotX + (e.clientY - lastPtr.y) * 0.005));
    lastPtr = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
    lastPtr = null;
  });
  canvas.addEventListener('pointerleave', () => {
    dragging = false;
    lastPtr = null;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      userZoom = Math.max(0.4, Math.min(3, userZoom * (e.deltaY > 0 ? 0.94 : 1.06)));
    },
    { passive: false },
  );

  window.addEventListener('resize', resize);

  return {
    push,
    start,
    stop,
    resize,
    stats: () => ({ nodes: nodes.size, flow }),
  };
}
