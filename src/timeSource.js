/**
 * Local calendar progress → OSC floats in [0, 1].
 */

export const TIME_PREFIX = '/time';

export const TIME_FIELDS = [
  { id: 'hour', address: '/time/hour', label: 'Hour' },
  { id: 'day', address: '/time/day', label: 'Day' },
  { id: 'week', address: '/time/week', label: 'Week' },
  { id: 'month', address: '/time/month', label: 'Month' },
  { id: 'year', address: '/time/year', label: 'Year' },
];

export const DEFAULT_TIME_FIELDS = {
  hour: true,
  day: true,
  week: true,
  month: true,
  year: true,
};

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday = 0 … Sunday = 6 (ISO), or Sunday = 0 when weekStart = 0. */
function weekdayOffset(d, weekStart) {
  const sun = d.getDay();
  if (weekStart === 0) return sun;
  return (sun + 6) % 7;
}

export function timeProgress(now = new Date(), { weekStart = 1 } = {}) {
  const t = now.getTime();

  const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const hourEnd = new Date(hourStart);
  hourEnd.setHours(hourEnd.getHours() + 1);

  const dayStart = startOfLocalDay(now);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const weekOff = weekdayOffset(now, weekStart);
  const weekStartDate = startOfLocalDay(now);
  weekStartDate.setDate(weekStartDate.getDate() - weekOff);
  const weekEnd = new Date(weekStartDate);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);

  return {
    hour: clamp01((t - hourStart.getTime()) / (hourEnd - hourStart)),
    day: clamp01((t - dayStart.getTime()) / (dayEnd - dayStart)),
    week: clamp01((t - weekStartDate.getTime()) / (weekEnd - weekStartDate)),
    month: clamp01((t - monthStart.getTime()) / (monthEnd - monthStart)),
    year: clamp01((t - yearStart.getTime()) / (yearEnd - yearStart)),
    clock: now,
  };
}

export function timeToOsc(values, fields) {
  const msgs = [];
  for (const f of TIME_FIELDS) {
    if (fields && fields[f.id] === false) continue;
    const v = values[f.id];
    if (!Number.isFinite(v)) continue;
    msgs.push({ address: f.address, args: [Math.round(v * 1e6) / 1e6] });
  }
  return msgs;
}

export class TimeSource {
  constructor({ onSample, onStatus } = {}) {
    this.onSample = onSample || (() => {});
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.weekStart = 1;
    this.hz = 4;
    this.last = null;
    this._timer = null;
  }

  setOptions({ weekStart, hz } = {}) {
    if (weekStart === 0 || weekStart === 1) this.weekStart = weekStart;
    if (hz != null) this.hz = Math.max(1, Math.min(30, Number(hz) || 4));
    if (this.running) this.start();
  }

  start() {
    this.running = true;
    this._emitStatus();
    this._tick();
    clearInterval(this._timer);
    this._timer = setInterval(() => this._tick(), 1000 / this.hz);
  }

  stop() {
    this.running = false;
    clearInterval(this._timer);
    this._timer = null;
    this._emitStatus();
  }

  sample() {
    this.last = timeProgress(new Date(), { weekStart: this.weekStart });
    return this.last;
  }

  _tick() {
    const sample = this.sample();
    this.onSample(sample);
  }

  _emitStatus() {
    this.onStatus({ connected: this.running, running: this.running });
  }
}
