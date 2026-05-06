// Accepts: (x|y)  x|y  x/y  -x|-y  -x/y  etc.
const COORD_RE = /^\(?\s*(-?\d{1,3})\s*[|\/]\s*(-?\d{1,3})\s*\)?$/;

export function parseCoords(input) {
  const m = String(input).trim().match(COORD_RE);
  if (!m) return null;
  const x = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);
  if (x < -400 || x > 400 || y < -400 || y > 400) return null;
  return { x, y };
}

export function formatCoords(x, y) {
  return `(${x}|${y})`;
}
