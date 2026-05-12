import { prepare } from '../db/client.js';

// Strip accents, lowercase, remove all non-letter/number chars.
// Used for map-matching and normalized storage.
function normalizeForMatch(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

export function validateIgnAgainstMap(input) {
  const norm = normalizeForMatch(input);
  if (!norm) return { ok: false, reason: 'empty' };

  const allPlayers = prepare(`
    SELECT DISTINCT player, uid
    FROM x_world
    WHERE player IS NOT NULL AND player != ''
  `).all();

  const matches = allPlayers.filter(row => normalizeForMatch(row.player) === norm);

  if (matches.length === 0) return { ok: false, reason: 'not_found' };

  const uidSet = new Set(matches.map(m => m.uid));
  if (uidSet.size > 1) {
    return { ok: false, reason: 'ambiguous', candidates: matches };
  }

  return { ok: true, canonical: matches[0].player };
}

export function findAccountByNormalizedIgn(normalizedIgn) {
  return prepare('SELECT * FROM travian_accounts WHERE normalized_ign = ?').get(normalizedIgn) ?? null;
}

export function findAccountByIgn(ign) {
  return findAccountByNormalizedIgn(normalizeForMatch(ign));
}

export function upsertAccountFromMap(ign) {
  const norm = normalizeForMatch(ign);
  if (!norm) throw new Error('upsertAccountFromMap: empty ign');
  prepare(`
    INSERT OR IGNORE INTO travian_accounts (ign, normalized_ign)
    VALUES (?, ?)
  `).run(ign, norm);
}

export function setAccountCoords(ign, x, y) {
  prepare('UPDATE travian_accounts SET home_x = ?, home_y = ? WHERE ign = ?').run(x, y, ign);
}

export function setAccountTribe(ign, tribe) {
  prepare('UPDATE travian_accounts SET tribe = ? WHERE ign = ?').run(tribe, ign);
}
