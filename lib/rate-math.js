const MIN = 0.1;
const MAX = 10.0;

function clampRate(n) {
  return Math.min(MAX, Math.max(MIN, n));
}

function roundRate(n) {
  return Math.round(n * 10) / 10;
}

function effectiveRate(baseRate, holdMultiplier) {
  return clampRate(roundRate(baseRate * holdMultiplier));
}

function parseCustomRate(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampRate(n);
}

module.exports = { clampRate, roundRate, effectiveRate, parseCustomRate, MIN, MAX };
