/**
 * Dark OSM/Carto map: pan, zoom, click to pick a lat/lon.
 */

const TILE = 256;
const TILE_URL = (z, x, y) =>
  `https://${'abc'[Math.abs(x + y) % 3]}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function lonToX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}

function latToY(lat, z) {
  const s = Math.sin((clamp(lat, -85.05, 85.05) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

function xToLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function yToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export class GeoMap {
  constructor(host, { lat = 40, lon = 10, zoom = 3, onPick } = {}) {
    this.host = host;
    this.lat = lat;
    this.lon = lon;
    this.zoom = zoom;
    this.onPick = onPick || (() => {});
    this.pick = null;
    this._drag = null;
    this._moved = false;

    host.classList.add('geomap');
    host.innerHTML = `
      <div class="geomap-view" tabindex="0">
        <div class="geomap-tiles"></div>
        <div class="geomap-pin hidden"></div>
      </div>
      <div class="geomap-tools">
        <button type="button" data-zoom="1" aria-label="Zoom in">+</button>
        <button type="button" data-zoom="-1" aria-label="Zoom out">−</button>
        <button type="button" data-locate aria-label="My location">⌖</button>
      </div>
      <div class="geomap-attrib">© OSM © CARTO</div>
    `;
    this.view = host.querySelector('.geomap-view');
    this.tiles = host.querySelector('.geomap-tiles');
    this.pin = host.querySelector('.geomap-pin');

    this.view.addEventListener('pointerdown', (e) => this._onDown(e));
    this.view.addEventListener('pointermove', (e) => this._onMove(e));
    this.view.addEventListener('pointerup', (e) => this._onUp(e));
    this.view.addEventListener('pointercancel', () => this._endDrag());
    this.view.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    host.querySelector('[data-zoom="1"]')?.addEventListener('click', () => this.zoomBy(1));
    host.querySelector('[data-zoom="-1"]')?.addEventListener('click', () => this.zoomBy(-1));
    host.querySelector('[data-locate]')?.addEventListener('click', () => this.locate());

    this._ro = new ResizeObserver(() => this.render());
    this._ro.observe(this.view);
    this.render();
  }

  setView(lat, lon, zoom) {
    if (Number.isFinite(lat)) this.lat = clamp(lat, -85, 85);
    if (Number.isFinite(lon)) this.lon = ((lon + 540) % 360) - 180;
    if (Number.isFinite(zoom)) this.zoom = clamp(Math.round(zoom), 1, 18);
    this.render();
  }

  setPick(lat, lon, { fly = true } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    this.pick = { lat, lon };
    if (fly) this.setView(lat, lon, Math.max(this.zoom, 8));
    else this.render();
  }

  clearPick() {
    this.pick = null;
    this.render();
  }

  zoomBy(delta) {
    this.zoom = clamp(this.zoom + delta, 1, 18);
    this.render();
  }

  locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        this.setPick(lat, lon);
        this.onPick({ lat, lon, source: 'locate' });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  resize() {
    this.render();
  }

  _onDown(e) {
    this.view.setPointerCapture(e.pointerId);
    this._moved = false;
    this._drag = { x: e.clientX, y: e.clientY, lat: this.lat, lon: this.lon };
  }

  _onMove(e) {
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    if (Math.hypot(dx, dy) > 4) this._moved = true;
    const z = this.zoom;
    this.lon = xToLon(lonToX(this._drag.lon, z) - dx / TILE, z);
    this.lat = clamp(yToLat(latToY(this._drag.lat, z) - dy / TILE, z), -85, 85);
    this.render();
  }

  _onUp(e) {
    if (!this._drag) return;
    const wasDrag = this._moved;
    this._endDrag();
    if (wasDrag) return;
    const pt = this._eventToLatLon(e);
    this.setPick(pt.lat, pt.lon, { fly: false });
    this.onPick({ ...pt, source: 'map' });
  }

  _endDrag() {
    this._drag = null;
  }

  _onWheel(e) {
    e.preventDefault();
    this.zoomBy(e.deltaY < 0 ? 1 : -1);
  }

  _eventToLatLon(e) {
    const r = this.view.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2;
    const dy = e.clientY - r.top - r.height / 2;
    const z = this.zoom;
    return {
      lat: clamp(yToLat(latToY(this.lat, z) + dy / TILE, z), -85, 85),
      lon: xToLon(lonToX(this.lon, z) + dx / TILE, z),
    };
  }

  render() {
    const w = this.view.clientWidth;
    const h = this.view.clientHeight;
    if (w < 8 || h < 8) return;
    const z = this.zoom;
    const n = 2 ** z;
    const cx = lonToX(this.lon, z);
    const cy = latToY(this.lat, z);
    const x0 = Math.floor(cx - w / 2 / TILE) - 1;
    const y0 = Math.floor(cy - h / 2 / TILE) - 1;
    const x1 = Math.ceil(cx + w / 2 / TILE) + 1;
    const y1 = Math.ceil(cy + h / 2 / TILE) + 1;

    const used = new Set();
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        const key = `${z}:${wx}:${ty}`;
        used.add(key);
        let img = this.tiles.querySelector(`[data-tile="${key}"]`);
        if (!img) {
          img = document.createElement('img');
          img.dataset.tile = key;
          img.alt = '';
          img.draggable = false;
          img.src = TILE_URL(z, wx, ty);
          this.tiles.appendChild(img);
        }
        img.style.transform = `translate(${(tx - cx) * TILE + w / 2}px, ${(ty - cy) * TILE + h / 2}px)`;
      }
    }
    this.tiles.querySelectorAll('img').forEach((img) => {
      if (!used.has(img.dataset.tile)) img.remove();
    });

    if (this.pick) {
      const px = (lonToX(this.pick.lon, z) - cx) * TILE + w / 2;
      const py = (latToY(this.pick.lat, z) - cy) * TILE + h / 2;
      this.pin.classList.remove('hidden');
      this.pin.style.transform = `translate(${px}px, ${py}px)`;
    } else {
      this.pin.classList.add('hidden');
    }
  }
}
