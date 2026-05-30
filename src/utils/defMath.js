export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function defValue(inf, cav) {
  return (inf | 0) + (cav | 0) * 2;
}

export function avgWaveGapSec(spreadSec, waves) {
  if (spreadSec == null || !Number.isInteger(waves) || waves < 2) return null;
  return spreadSec / (waves - 1);
}
