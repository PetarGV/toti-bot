export const RESOURCES = {
  lumber: { label: 'Lumber',        emoji: '🪵', color: 0x8b4513 },
  clay:   { label: 'Clay',          emoji: '🧱', color: 0xd2691e },
  iron:   { label: 'Iron',          emoji: '🔩', color: 0x808080 },
  crop:   { label: 'Crop',          emoji: '🌾', color: 0xffd700 },
  all:    { label: 'All Resources', emoji: '📦', color: 0x9b59b6 },
};

export function getResource(id) {
  const r = RESOURCES[id];
  if (!r) throw new Error(`Unknown resource: ${id}`);
  return r;
}

const MAX_AMOUNT = 10_000_000;

export function parseAmount(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase().replace(/[, _]/g, '');
  if (!s) return null;

  let multiplier = 1;
  if (s.endsWith('m')) { multiplier = 1_000_000; s = s.slice(0, -1); }
  else if (s.endsWith('k')) { multiplier = 1_000; s = s.slice(0, -1); }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * multiplier);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  return n;
}

export function formatAmount(n) {
  return Number(n).toLocaleString('en-US');
}