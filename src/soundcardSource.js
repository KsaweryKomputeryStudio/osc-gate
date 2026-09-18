/**
 * Soundcard source helpers (capture lives in the Node gateway).
 */

export const SOUNDCARD_MAX_CHANNELS = 16;

export function soundcardSignalRows(inst) {
  const n = Math.max(
    1,
    Math.min(SOUNDCARD_MAX_CHANNELS, Number(inst?.settings?.channels) || 8),
  );
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({ key: `ch/${i}`, label: `Ch ${i}` });
    rows.push({ key: `ch/${i}/peak`, label: `Ch ${i} peak` });
  }
  return rows;
}

export function flattenSoundcard({ levels = [], peaks = [] } = {}) {
  const values = {};
  const n = Math.max(levels.length, peaks.length);
  for (let i = 0; i < n; i++) {
    values[`ch/${i + 1}`] = Number(levels[i]) || 0;
    values[`ch/${i + 1}/peak`] = Number(peaks[i]) || 0;
  }
  return values;
}
