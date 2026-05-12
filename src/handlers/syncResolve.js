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

export function computeAmbiguous(audit) {
  return (audit.ambiguous ?? []).map(row => ({
    discordId:   row.member.id,
    displayName: row.displayName,
    candidates:  (row.players ?? []).map(p => p.player),
  }));
}

// Returns:
// - { ok: true, next: 'done' } when the link was set directly (user had no primary)
// - { ok: true, next: 'conflict' } when caller should route through applyConflictAction
// - { ok: false, reason } on validation failure
export function applyAmbiguousPick({ discordId, pickedIgn }) {
  const valid = validateIgnAgainstMap(pickedIgn);
  if (!valid.ok) return { ok: false, reason: 'invalid_ign' };

  const primary = getPrimaryLinkForUser(discordId);
  if (primary) {
    return { ok: true, next: 'conflict' };
  }

  const run = transaction(() => {
    prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(discordId);
    upsertAccountFromMap(valid.canonical);
    prepare(`INSERT INTO user_ign_links (discord_id, ign, is_primary, source) VALUES (?, ?, 1, 'admin')`).run(discordId, valid.canonical);
  });
  run();

  return { ok: true, next: 'done' };
}

function ensureSameAdmin(interaction, encodedAdminId) {
  if (interaction.user.id !== encodedAdminId) {
    return interaction.reply({ content: 'Only the admin who ran sync can resolve these.', ephemeral: true });
  }
  return null;
}

export async function handleResolveConflictsButton(interaction) {
  const [, , adminId] = interaction.customId.split(':');
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  const conflictRows = extractRowsFromEmbed(interaction.message, 'Profile Conflicts');
  if (conflictRows.length === 0) {
    return interaction.reply({ content: 'No conflicts left to resolve. Re-run `/admin sync-members` for a fresh report.', ephemeral: true });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`sync:pick-conflict:${adminId}`)
    .setPlaceholder('Pick a conflict to resolve…')
    .addOptions(conflictRows.slice(0, 25).map(r =>
      new StringSelectMenuOptionBuilder()
        .setValue(`${r.discordId}|${encodeURIComponent(r.targetIgn)}`)
        .setLabel(`${r.displayName ?? r.discordId} → ${r.targetIgn}`.slice(0, 100))
        .setDescription(`current: ${r.existingIgn}`.slice(0, 100))
    ));
  return interaction.reply({
    content: 'Select a conflict to resolve:',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleResolveAmbigButton(interaction) {
  const [, , adminId] = interaction.customId.split(':');
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  const ambigRows = extractRowsFromEmbed(interaction.message, 'Ambiguous Names');
  if (ambigRows.length === 0) {
    return interaction.reply({ content: 'No ambiguous rows left. Re-run `/admin sync-members` for a fresh report.', ephemeral: true });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`sync:pick-ambig:${adminId}`)
    .setPlaceholder('Pick an ambiguous member…')
    .addOptions(ambigRows.slice(0, 25).map(r =>
      new StringSelectMenuOptionBuilder()
        .setValue(`${r.discordId}|${(r.candidates ?? []).map(encodeURIComponent).join(',')}`)
        .setLabel(`${r.displayName ?? r.discordId}`.slice(0, 100))
        .setDescription(`candidates: ${(r.candidates ?? []).join(', ')}`.slice(0, 100))
    ));
  return interaction.reply({
    content: 'Select a member, then I\'ll show their candidate names:',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleConflictPickSelect(interaction) {
  const [, , adminId] = interaction.customId.split(':');
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  const [discordId, encodedIgn] = interaction.values[0].split('|');
  const targetIgn = decodeURIComponent(encodedIgn);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(targetIgn)}:replace`).setLabel('Replace primary').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(targetIgn)}:secondary`).setLabel('Add as secondary').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(targetIgn)}:skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  return interaction.update({
    content: `Resolve <@${discordId}> → **${targetIgn}**:`,
    components: [row],
  });
}

export async function handleAmbigPickSelect(interaction) {
  const [, , adminId] = interaction.customId.split(':');
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  const [discordId, encodedCsv] = interaction.values[0].split('|');
  const candidates = encodedCsv.split(',').map(decodeURIComponent);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`sync:ambig-candidate:${adminId}:${discordId}`)
    .setPlaceholder('Pick the correct Travian IGN…')
    .addOptions(candidates.slice(0, 25).map(c =>
      new StringSelectMenuOptionBuilder().setValue(c).setLabel(c)
    ));
  return interaction.update({
    content: `Pick the correct IGN for <@${discordId}>:`,
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

export async function handleAmbigCandidateSelect(interaction) {
  const parts = interaction.customId.split(':');
  const adminId = parts[2];
  const discordId = parts[3];
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  const pickedIgn = interaction.values[0];
  const result = applyAmbiguousPick({ discordId, pickedIgn });
  if (!result.ok) {
    return interaction.update({ content: `❌ ${result.reason}`, components: [] });
  }
  if (result.next === 'done') {
    return interaction.update({ content: `✅ Linked <@${discordId}> → **${pickedIgn}**.`, components: [] });
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(pickedIgn)}:replace`).setLabel('Replace primary').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(pickedIgn)}:secondary`).setLabel('Add as secondary').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(pickedIgn)}:skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  return interaction.update({
    content: `<@${discordId}> already has a primary. Resolve **${pickedIgn}**:`,
    components: [row],
  });
}

export async function handleActButton(interaction) {
  const parts = interaction.customId.split(':');
  const adminId = parts[2];
  const discordId = parts[3];
  const encodedIgn = parts[4];
  const action = parts[5];
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  const targetIgn = decodeURIComponent(encodedIgn);
  const result = applyConflictAction({ action, discordId, targetIgn });
  if (!result.ok) {
    if (result.reason === 'already_resolved') {
      return interaction.update({ content: '⚠️ Already resolved — re-run `/admin sync-members` for a fresh report.', components: [] });
    }
    return interaction.update({ content: `❌ ${result.reason}`, components: [] });
  }
  const verb = action === 'skip' ? 'Skipped' : action === 'replace' ? 'Replaced primary' : 'Added as secondary';
  return interaction.update({
    content: `✅ ${verb}: <@${discordId}> → **${targetIgn}**.`,
    components: [],
  });
}

function extractRowsFromEmbed(message, fieldName) {
  const out = [];
  const embed = message?.embeds?.[0];
  if (!embed) return out;
  const field = embed.fields?.find(f => f.name === fieldName);
  if (!field) return out;
  if (fieldName === 'Profile Conflicts') {
    const re = /<@(\d+)> has profile \*\*([^*]+)\*\*, matched \*\*([^*]+)\*\*/g;
    let m;
    while ((m = re.exec(field.value)) !== null) {
      out.push({ discordId: m[1], existingIgn: m[2], targetIgn: m[3] });
    }
  } else if (fieldName === 'Ambiguous Names') {
    const lines = field.value.split('\n');
    for (const line of lines) {
      const idMatch = line.match(/<@(\d+)>/);
      const nameMatch = line.match(/\*\*([^*]+)\*\*\s*->\s*(.+)$/);
      if (!nameMatch) continue;
      const displayName = nameMatch[1];
      const candidates = nameMatch[2].split(/\s*\/\s*/).map(s => s.trim());
      out.push({ discordId: idMatch?.[1], displayName, candidates });
    }
  }
  return out;
}
