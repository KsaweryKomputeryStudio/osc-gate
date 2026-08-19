/**
 * Incoming OSC arg normalization (passthrough Auto/Manual 0–1).
 * Shared by the browser UI and the Node gateway.
 */

export function asNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function argValue(a) {
  if (a && typeof a === 'object' && 'value' in a) return argValue(a.value);
  return a;
}

export function argVals(args) {
  return (args || []).map(argValue);
}

export function firstNumber(vals) {
  for (const v of vals || []) {
    const n = asNumber(v);
    if (n != null) return n;
  }
  return null;
}

export function scale01(v, min, max) {
  const n = asNumber(v);
  if (n == null) return v;
  const lo = asNumber(min);
  const hi = asNumber(max);
  if (lo == null || hi == null || lo === hi) return 0.5;
  return Math.min(1, Math.max(0, (n - lo) / (hi - lo)));
}

export function observeRange(prev, sample) {
  const n = asNumber(sample);
  if (n == null) return prev || null;
  if (!prev) return { min: n, max: n };
  return {
    min: n < prev.min ? n : prev.min,
    max: n > prev.max ? n : prev.max,
  };
}

export function specRange(spec, observed) {
  if (!spec || spec.mode === 'off') return null;
  if (spec.mode === 'auto') {
    return {
      min: observed?.min,
      max: observed?.max,
    };
  }
  return { min: spec.min, max: spec.max };
}

export function transformArgs(args, spec, observed) {
  const autoMin = observed?.min;
  const autoMax = observed?.max;
  const range = specRange(spec, observed);
  if (!range) return { args: args || [], autoMin, autoMax };
  const out = (args || []).map((a) => {
    const n = asNumber(argValue(a));
    if (n == null) return a;
    const scaled = scale01(n, range.min, range.max);
    if (a && typeof a === 'object' && a.type) return { type: 'f', value: scaled };
    return scaled;
  });
  return { args: out, autoMin, autoMax };
}

export function normalizeSpec(spec) {
  const mode = spec?.mode === 'auto' || spec?.mode === 'manual' ? spec.mode : 'off';
  let min = Number(spec?.min);
  let max = Number(spec?.max);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  return { mode, min, max, resetAuto: !!spec?.resetAuto };
}
