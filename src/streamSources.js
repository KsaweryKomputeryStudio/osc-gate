/**
 * Persistent WebSocket / EventSource collectors for poll-view sources.
 * startStream() returns { sample, stop }. sample() snapshots and resets window counters.
 */

const JETSTREAM_HOSTS = [
  'jetstream2.us-east.bsky.network',
  'jetstream1.us-east.bsky.network',
  'jetstream2.us-west.bsky.network',
  'jetstream1.us-west.bsky.network',
];

export function isStreamType(type) {
  return type === 'bsky' || type === 'wiki-live' || type === 'hn' || type === 'ais';
}

export function startStream(type, settings = {}) {
  if (type === 'bsky') return startBsky(settings);
  if (type === 'wiki-live') return startWikiLive(settings);
  if (type === 'hn') return startHnLive(settings);
  if (type === 'ais') return startAis(settings);
  throw new Error(`Unknown stream source ${type}`);
}

function startBsky() {
  const acc = { posts: 0, chars: 0, started: Date.now() };
  let ws = null;
  let hostIndex = 0;
  let closed = false;
  let retry = 500;
  let timer = null;

  const connect = () => {
    if (closed) return;
    const host = JETSTREAM_HOSTS[hostIndex % JETSTREAM_HOSTS.length];
    const url = `wss://${host}/subscribe?wantedCollections=app.bsky.feed.post`;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      schedule(err);
      return;
    }
    ws.onmessage = (ev) => {
      retry = 500;
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const commit = msg?.commit;
      if (msg?.kind !== 'commit' || commit?.operation !== 'create') return;
      if (commit?.collection && commit.collection !== 'app.bsky.feed.post') return;
      const text = String(commit?.record?.text || '');
      acc.posts += 1;
      acc.chars += text.length;
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!closed) {
        hostIndex += 1;
        schedule();
      }
    };
  };

  const schedule = () => {
    clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(connect, retry);
    retry = Math.min(8000, retry * 1.6);
  };

  connect();
  return {
    sample() {
      const dt = Math.max(0.2, (Date.now() - acc.started) / 1000);
      const posts = acc.posts;
      const chars = posts ? acc.chars / posts : 0;
      acc.posts = 0;
      acc.chars = 0;
      acc.started = Date.now();
      return {
        label: `${posts} posts / ${dt.toFixed(1)}s`,
        values: {
          posts,
          rate: Math.round((posts / dt) * 10) / 10,
          chars: Math.round(chars),
        },
      };
    },
    stop() {
      closed = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function startWikiLive({ wiki = '' } = {}) {
  const want = String(wiki || '').trim();
  const acc = { edits: 0, bots: 0, started: Date.now() };
  let es = null;
  let closed = false;
  let retry = 800;
  let timer = null;

  const connect = () => {
    if (closed) return;
    try {
      es = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');
    } catch {
      schedule();
      return;
    }
    es.onmessage = (ev) => {
      retry = 800;
      let row;
      try {
        row = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (want && row?.wiki && row.wiki !== want) return;
      acc.edits += 1;
      if (row?.bot) acc.bots += 1;
    };
    es.onerror = () => {
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      schedule();
    };
  };

  const schedule = () => {
    clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(connect, retry);
    retry = Math.min(10000, retry * 1.5);
  };

  connect();
  return {
    sample() {
      const dt = Math.max(0.2, (Date.now() - acc.started) / 1000);
      const edits = acc.edits;
      const bots = acc.bots;
      acc.edits = 0;
      acc.bots = 0;
      acc.started = Date.now();
      return {
        label: `${edits} edits / ${dt.toFixed(1)}s`,
        values: {
          edits,
          bots,
          rate: Math.round((edits / dt) * 10) / 10,
        },
      };
    },
    stop() {
      closed = true;
      clearTimeout(timer);
      try {
        es?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function startHnLive() {
  const acc = { maxitem: 0, last: 0, started: Date.now() };
  let es = null;
  let closed = false;
  let retry = 800;
  let timer = null;

  const apply = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return;
    if (!acc.last) acc.last = v;
    acc.maxitem = v;
  };

  const connect = () => {
    if (closed) return;
    try {
      es = new EventSource('https://hacker-news.firebaseio.com/v0/maxitem.json');
    } catch {
      schedule();
      return;
    }
    es.onmessage = (ev) => {
      retry = 800;
      let payload = ev.data;
      try {
        const parsed = JSON.parse(ev.data);
        payload = parsed?.data ?? parsed;
      } catch {
        /* raw number */
      }
      apply(payload);
    };
    es.addEventListener('put', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        apply(parsed?.data);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      schedule();
    };
  };

  const schedule = () => {
    clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(connect, retry);
    retry = Math.min(10000, retry * 1.5);
  };

  fetch('https://hacker-news.firebaseio.com/v0/maxitem.json')
    .then((r) => r.json())
    .then(apply)
    .catch(() => {});

  connect();
  return {
    sample() {
      const maxitem = acc.maxitem || acc.last;
      const delta = acc.last ? Math.max(0, maxitem - acc.last) : 0;
      acc.last = maxitem;
      const dt = Math.max(0.2, (Date.now() - acc.started) / 1000);
      acc.started = Date.now();
      return {
        label: delta ? `+${delta}` : 'idle',
        values: {
          delta,
          maxitem,
          rate: Math.round((delta / dt) * 10) / 10,
        },
      };
    },
    stop() {
      closed = true;
      clearTimeout(timer);
      try {
        es?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function startAis({ apiKey = '', lat = 54.52, lon = 18.53, radiusKm = 12 } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) {
    return {
      sample() {
        throw new Error('API key required');
      },
      stop() {},
    };
  }
  const box = boundingBox(lat, lon, radiusKm);
  const ships = new Map();
  let ws = null;
  let closed = false;
  let retry = 800;
  let timer = null;

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      retry = 800;
      const payload = JSON.stringify({
        APIKey: key,
        BoundingBoxes: [
          [
            [box.south, box.west],
            [box.north, box.east],
          ],
        ],
        FilterMessageTypes: ['PositionReport'],
      });
      const send = () => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(payload);
      };
      send();
      setTimeout(send, 400);
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const report = msg?.Message?.PositionReport || msg?.PositionReport || msg;
      const mmsi = String(report?.UserID || report?.MMSI || msg?.MetaData?.MMSI || '');
      if (!mmsi) return;
      const sog = Number(report?.Sog ?? report?.SOG ?? 0);
      ships.set(mmsi, { sog: Number.isFinite(sog) ? sog : 0, t: Date.now() });
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!closed) schedule();
    };
  };

  const schedule = () => {
    clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(connect, retry);
    retry = Math.min(10000, retry * 1.5);
  };

  connect();
  return {
    sample() {
      const now = Date.now();
      for (const [id, row] of ships) {
        if (now - row.t > 120000) ships.delete(id);
      }
      let speed = 0;
      let moving = 0;
      for (const row of ships.values()) {
        speed = Math.max(speed, row.sog);
        if (row.sog >= 0.5) moving += 1;
      }
      const count = ships.size;
      return {
        label: `${count} ships`,
        values: {
          count,
          moving,
          speed: Math.round(speed * 10) / 10,
        },
      };
    },
    stop() {
      closed = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function boundingBox(lat, lon, km) {
  const dLat = Number(km) / 111;
  const cos = Math.cos((Number(lat) * Math.PI) / 180);
  const dLon = Number(km) / (111 * Math.max(0.2, cos));
  return {
    south: Number(lat) - dLat,
    north: Number(lat) + dLat,
    west: Number(lon) - dLon,
    east: Number(lon) + dLon,
  };
}
