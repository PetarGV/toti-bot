// Accepts many formats: (x|y), x|y, x/y, x,y, x;y, x y, [-12|34], {-12 / 34}, etc.
// Two signed integers separated by any of: | / , ; or whitespace, with optional () [] {} wrapping.
const COORD_RE = /^[\s\(\[\{]*(-?\d{1,3})\s*[|/,;\s]+\s*(-?\d{1,3})[\s\)\]\}]*$/;

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
