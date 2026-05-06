import { prepare } from '../db/client.js';

// Normalize an IGN for grouping: trim, lowercase, collapse whitespace.
// Returns null for empty/blank input.
export function normalizeIgn(ign) {
  if (ign == null) return null;
  const s = String(ign).trim().toLowerCase().replace(/\s+/g, ' ');
  return s || null;
}

// All { discord_id, ign } rows whose normalized IGN equals the given one.
export function getUsersByIgn(ign) {
  const norm = normalizeIgn(ign);
  if (!norm) return [];
  const all = prepare('SELECT discord_id, ign FROM users WHERE ign IS NOT NULL').all();
  return all.filter(u => normalizeIgn(u.ign) === norm);
}

// Discord user rows sharing the given user's IGN, excluding the user themselves.
// Returns [] if the user has no IGN set.
export function getDualsForUser(userId) {
  const me = prepare('SELECT ign FROM users WHERE discord_id = ?').get(userId);
  if (!me?.ign) return [];
  return getUsersByIgn(me.ign).filter(u => u.discord_id !== userId);
}
