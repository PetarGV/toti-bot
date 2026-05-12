import { prepare, transaction } from '../db/client.js';
import {
  validateIgnAgainstMap,
  upsertAccountFromMap,
  findAccountByNormalizedIgn,
} from './travianAccounts.js';

// Internal normalization — must match the one in travianAccounts.js
function normalizeForMatch(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

export function getPrimaryLinkForUser(discordId) {
  return prepare(`
    SELECT l.discord_id, l.ign, l.is_primary, l.source, l.created_at,
           a.home_x, a.home_y, a.tribe, a.normalized_ign
    FROM user_ign_links l
    JOIN travian_accounts a ON a.ign = l.ign
    WHERE l.discord_id = ? AND l.is_primary = 1
  `).get(discordId) ?? null;
}

export function getAllLinksForUser(discordId) {
  return prepare(`
    SELECT l.discord_id, l.ign, l.is_primary, l.source, l.created_at,
           a.home_x, a.home_y, a.tribe, a.normalized_ign
    FROM user_ign_links l
    JOIN travian_accounts a ON a.ign = l.ign
    WHERE l.discord_id = ?
    ORDER BY l.is_primary DESC, l.created_at ASC
  `).all(discordId);
}

function ensureUser(discordId) {
  prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(discordId);
}

export function setUserIgnFromInput(discordId, input) {
  const validation = validateIgnAgainstMap(input);
  if (!validation.ok) return validation;
  const canonical = validation.canonical;

  const run = transaction(() => {
    ensureUser(discordId);
    upsertAccountFromMap(canonical);

    // Delete any self/sync links that are NOT the new canonical ign
    prepare(`
      DELETE FROM user_ign_links
      WHERE discord_id = ?
        AND ign != ?
        AND source IN ('self', 'sync')
    `).run(discordId, canonical);

    // Demote all other links to non-primary
    prepare(`
      UPDATE user_ign_links SET is_primary = 0 WHERE discord_id = ? AND ign != ?
    `).run(discordId, canonical);

    // Insert or promote the target link
    const existing = prepare(`
      SELECT 1 FROM user_ign_links WHERE discord_id = ? AND ign = ?
    `).get(discordId, canonical);

    if (existing) {
      prepare(`
        UPDATE user_ign_links SET is_primary = 1 WHERE discord_id = ? AND ign = ?
      `).run(discordId, canonical);
    } else {
      prepare(`
        INSERT INTO user_ign_links (discord_id, ign, is_primary, source)
        VALUES (?, ?, 1, 'self')
      `).run(discordId, canonical);
    }
  });
  run();

  return { ok: true, canonical };
}

export function adminLink(discordId, input) {
  const validation = validateIgnAgainstMap(input);
  if (!validation.ok) return validation;
  const canonical = validation.canonical;

  const run = transaction(() => {
    ensureUser(discordId);
    upsertAccountFromMap(canonical);

    const existing = prepare(`
      SELECT is_primary FROM user_ign_links WHERE discord_id = ? AND ign = ?
    `).get(discordId, canonical);
    if (existing) return; // idempotent no-op

    prepare(`
      INSERT INTO user_ign_links (discord_id, ign, is_primary, source)
      VALUES (?, ?, 0, 'admin')
    `).run(discordId, canonical);
  });
  run();

  return { ok: true, canonical };
}

export function adminUnlink(discordId, input) {
  const account = findAccountByNormalizedIgn(normalizeForMatch(input));
  if (!account) return { ok: false, reason: 'no_account' };
  const canonical = account.ign;

  const run = transaction(() => {
    const removed = prepare(`
      SELECT is_primary FROM user_ign_links WHERE discord_id = ? AND ign = ?
    `).get(discordId, canonical);
    if (!removed) return;
    prepare('DELETE FROM user_ign_links WHERE discord_id = ? AND ign = ?').run(discordId, canonical);

    if (removed.is_primary === 1) {
      const next = prepare(`
        SELECT ign FROM user_ign_links
        WHERE discord_id = ?
        ORDER BY created_at ASC
        LIMIT 1
      `).get(discordId);
      if (next) {
        prepare('UPDATE user_ign_links SET is_primary = 1 WHERE discord_id = ? AND ign = ?')
          .run(discordId, next.ign);
      }
    }
  });
  run();

  return { ok: true, canonical };
}

export function adminSetPrimary(discordId, input) {
  const account = findAccountByNormalizedIgn(normalizeForMatch(input));
  if (!account) return { ok: false, reason: 'no_account' };
  const canonical = account.ign;

  const existing = prepare('SELECT 1 FROM user_ign_links WHERE discord_id = ? AND ign = ?')
    .get(discordId, canonical);
  if (!existing) return { ok: false, reason: 'not_linked' };

  const run = transaction(() => {
    prepare('UPDATE user_ign_links SET is_primary = 0 WHERE discord_id = ? AND ign != ?')
      .run(discordId, canonical);
    prepare('UPDATE user_ign_links SET is_primary = 1 WHERE discord_id = ? AND ign = ?')
      .run(discordId, canonical);
  });
  run();

  return { ok: true, canonical };
}

export function getDualsForUser(discordId) {
  return prepare(`
    SELECT DISTINCT other.discord_id, otherLink.ign
    FROM user_ign_links mine
    JOIN user_ign_links otherLink ON otherLink.ign = mine.ign AND otherLink.discord_id != mine.discord_id
    JOIN users other ON other.discord_id = otherLink.discord_id
    WHERE mine.discord_id = ?
  `).all(discordId);
}

export function getUsersByIgn(input) {
  const norm = normalizeForMatch(input);
  if (!norm) return [];
  return prepare(`
    SELECT l.discord_id, l.ign
    FROM user_ign_links l
    JOIN travian_accounts a ON a.ign = l.ign
    WHERE a.normalized_ign = ?
  `).all(norm);
}
