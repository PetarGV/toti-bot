// Accepts: "7m", "90s", "1h30m", "1:30:00", "45"
const RANGE_MIN = 60;
const RANGE_MAX = 24 * 3600;

export function parseDuration(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  // h:m:s or m:s
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return null;
    let total = 0;
    if (parts.length === 3) total = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) total = parts[0] * 60 + parts[1];
    else return null;
    return clamp(total);
  }

  // 1h30m / 7m / 90s / "45" (assume minutes if bare number ≥ 5, else seconds)
  const re = /(\d+)\s*(h|m|s)?/g;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === 'h') total += n * 3600;
    else if (unit === 's') total += n;
    else total += n * 60; // default minutes
  }
  if (!matched) return null;
  return clamp(total);
}

function clamp(n) {
  if (!Number.isFinite(n) || n < RANGE_MIN || n > RANGE_MAX) return null;
  return n;
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join('');
}