/**
 * Open-Meteo current weather (no API key).
 * https://open-meteo.com
 */

export const WEATHER_PREFIX = '/weather';

export const WEATHER_FIELDS = [
  { id: 'temp', address: '/weather/temp', label: 'Temp °C' },
  { id: 'feels', address: '/weather/feels', label: 'Feels °C' },
  { id: 'humidity', address: '/weather/humidity', label: 'Humidity %' },
  { id: 'humidity01', address: '/weather/humidity/norm', label: 'Humidity 0–1' },
  { id: 'windSpeed', address: '/weather/wind/speed', label: 'Wind km/h' },
  { id: 'windDir', address: '/weather/wind/dir', label: 'Wind dir °' },
  { id: 'windDir01', address: '/weather/wind/dir/norm', label: 'Wind dir 0–1' },
  { id: 'windGust', address: '/weather/wind/gust', label: 'Gust km/h' },
  { id: 'clouds', address: '/weather/clouds', label: 'Clouds %' },
  { id: 'pressure', address: '/weather/pressure', label: 'Pressure' },
  { id: 'precip', address: '/weather/precip', label: 'Precip mm' },
  { id: 'code', address: '/weather/code', label: 'WMO code' },
  { id: 'isDay', address: '/weather/is_day', label: 'Is day' },
  { id: 'lat', address: '/weather/lat', label: 'Latitude' },
  { id: 'lon', address: '/weather/lon', label: 'Longitude' },
];

export const DEFAULT_WEATHER_FIELDS = {
  temp: true,
  feels: false,
  humidity: false,
  humidity01: true,
  windSpeed: true,
  windDir: false,
  windDir01: true,
  windGust: false,
  clouds: true,
  pressure: false,
  precip: true,
  code: false,
  isDay: true,
  lat: false,
  lon: false,
};

const CURRENT =
  'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m';

const WMO = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

export function weatherLabel(code) {
  return WMO[Number(code)] || `Code ${code ?? '—'}`;
}

export function weatherToValues(cur, lat, lon) {
  const humidity = Number(cur.relative_humidity_2m);
  const dir = Number(cur.wind_direction_10m);
  return {
    temp: Number(cur.temperature_2m),
    feels: Number(cur.apparent_temperature),
    humidity,
    humidity01: Number.isFinite(humidity) ? humidity / 100 : NaN,
    windSpeed: Number(cur.wind_speed_10m),
    windDir: dir,
    windDir01: Number.isFinite(dir) ? dir / 360 : NaN,
    windGust: Number(cur.wind_gusts_10m),
    clouds: Number(cur.cloud_cover),
    pressure: Number(cur.pressure_msl),
    precip: Number(cur.precipitation ?? cur.rain),
    code: Number(cur.weather_code),
    isDay: Number(cur.is_day),
    lat: Number(lat),
    lon: Number(lon),
    condition: weatherLabel(cur.weather_code),
  };
}

export function weatherToOsc(values, fields) {
  const msgs = [];
  for (const f of WEATHER_FIELDS) {
    if (!fields?.[f.id]) continue;
    const v = values[f.id];
    if (!Number.isFinite(v)) continue;
    msgs.push({ address: f.address, args: [v] });
  }
  return msgs;
}

export async function searchPlaces(q) {
  const name = String(q || '').trim();
  if (name.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocode ${res.status}`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

export class WeatherSource {
  constructor({ onSample, onStatus } = {}) {
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.lat = null;
    this.lon = null;
    this.place = '';
    this.intervalSec = 60;
    this.running = false;
    this.last = null;
    this.error = '';
    this._timer = null;
    this._inflight = false;
  }

  setPoint(lat, lon, place = '') {
    this.lat = Number(lat);
    this.lon = Number(lon);
    this.place = place || this.place;
  }

  setIntervalSec(sec) {
    this.intervalSec = Math.max(15, Number(sec) || 60);
    if (this.running) this.start();
  }

  async start() {
    this.running = true;
    this._emitStatus();
    await this.refresh();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.refresh(), this.intervalSec * 1000);
  }

  stop() {
    this.running = false;
    clearInterval(this._timer);
    this._timer = null;
    this._emitStatus();
  }

  async refresh() {
    if (!Number.isFinite(this.lat) || !Number.isFinite(this.lon)) {
      this.error = 'Pick a point on the map';
      this._emitStatus();
      return null;
    }
    if (this._inflight) return this.last;
    this._inflight = true;
    this._emitStatus({ fetching: true });
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}` +
        `&current=${CURRENT}&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Weather ${res.status}`);
      const json = await res.json();
      const values = weatherToValues(json.current || {}, this.lat, this.lon);
      this.last = { ...values, place: this.place, fetchedAt: Date.now() };
      this.error = '';
      this.onSample(this.last);
      this._emitStatus();
      return this.last;
    } catch (err) {
      this.error = err.message || 'Weather fetch failed';
      this._emitStatus();
      return null;
    } finally {
      this._inflight = false;
    }
  }

  _emitStatus(extra = {}) {
    this.onStatus({
      connected: this.running && !!this.last && !this.error,
      running: this.running,
      fetching: !!extra.fetching,
      error: this.error,
      place: this.place,
      lat: this.lat,
      lon: this.lon,
    });
  }
}
