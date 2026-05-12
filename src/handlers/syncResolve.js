import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { prepare, transaction } from '../db/client.js';
import {
  getAllLinksForUser,
  getPrimaryLinkForUser,
} from './userIgnLinks.js';
import { upsertAccountFromMap, validateIgnAgainstMap } from './travianAccounts.js';
import { normalizeIgn } from '../utils/ign.js';

export function buildSyncResolveButtons({ adminId, conflicts, ambiguous }) {
  if (!conflicts && !ambiguous) return null;
  const row = new ActionRowBuilder();
  if (conflicts) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`sync:resolve-conflicts:${adminId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`🔧 Resolve ${conflicts} conflict${conflicts === 1 ? '' : 's'}`),
    );
  }
  if (ambiguous) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`sync:resolve-ambig:${adminId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`🔧 Resolve ${ambiguous} ambiguous`),
    );
  }
  return row;
}

export function computeConflicts(audit) {
  const out = [];
  for (const row of audit.matched ?? []) {
    const discordId = row.member.id;
    const links = getAllLinksForUser(discordId);
    if (links.length === 0) continue;
    if (links.some(l => l.normalized_ign === (row.player.normalizedName ?? normalizeIgn(row.player.player)))) continue;
    const primary = getPrimaryLinkForUser(discordId);
    out.push({
      discordId,
      existingIgn: primary?.ign ?? links[0].ign,
      targetIgn: row.player.player,
      displayName: row.displayName,
    });
  }
  return out;
}

export function applyConflictAction({ action, discordId, targetIgn }) {
  const valid = validateIgnAgainstMap(targetIgn);
  if (!valid.ok) return { ok: false, reason: 'invalid_ign' };

  const links = getAllLinksForUser(discordId);
  const normalizedTarget = normalizeIgn(valid.canonical);
  const alreadyHasTarget = links.some(l => l.normalized_ign === normalizedTarget);

  if (action === 'skip') {
    return { ok: true, noop: true };
  }

  if (alreadyHasTarget && action === 'secondary') {
    return { ok: false, reason: 'already_resolved' };
  }
  if (alreadyHasTarget && action === 'replace' && getPrimaryLinkForUser(discordId)?.normalized_ign === normalizedTarget) {
    return { ok: false, reason: 'already_resolved' };
  }

  const run = transaction(() => {
    prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(discordId);
    upsertAccountFromMap(valid.canonical);

    if (action === 'replace') {
      // Delete the current primary, insert/promote target as primary.
      prepare(`DELETE FROM user_ign_links WHERE discord_id = ? AND is_primary = 1`).run(discordId);
      prepare(`UPDATE user_ign_links SET is_primary = 0 WHERE discord_id = ? AND ign != ?`).run(discordId, valid.canonical);
      const existing = prepare('SELECT 1 FROM user_ign_links WHERE discord_id = ? AND ign = ?').get(discordId, valid.canonical);
      if (existing) {
        prepare('UPDATE user_ign_links SET is_primary = 1 WHERE discord_id = ? AND ign = ?').run(discordId, valid.canonical);
      } else {
        prepare(`INSERT INTO user_ign_links (discord_id, ign, is_primary, source) VALUES (?, ?, 1, 'admin')`).run(discordId, valid.canonical);
      }
    } else if (action === 'secondary') {
      prepare(`INSERT OR IGNORE INTO user_ign_links (discord_id, ign, is_primary, source) VALUES (?, ?, 0, 'admin')`).run(discordId, valid.canonical);
    }
  });
  run();

  return { ok: true };
}
