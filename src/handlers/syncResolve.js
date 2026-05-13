import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { prepare, transaction } from '../db/client.js';
import {
  getAllLinksForUser,
  getPrimaryLinkForUser,
} from './userIgnLinks.js';
import { upsertAccountFromMap, validateIgnAgainstMap } from './travianAccounts.js';
import { normalizeIgn } from '../utils/ign.js';
import { buildMemberMapAudit, getTravianPlayersFromMap } from '../utils/memberMapMonitor.js';
import { assignRolesFromIgn } from './memberRoles.js';
import { renameOnboardingChannel, updateOnboardingChannelTopic } from './onboarding.js';
import { logger } from '../utils/logger.js';

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

  await interaction.deferReply({ ephemeral: true });
  const players = getTravianPlayersFromMap();
  let memberCollection;
  try {
    memberCollection = interaction.guild.members.cache.size > 0
      ? interaction.guild.members.cache
      : await interaction.guild.members.fetch();
  } catch (err) {
    logger.error('syncResolve: guild.members.fetch failed:', err.message);
    return interaction.editReply({ content: `❌ Could not fetch guild members: ${err.message}` });
  }
  const members = Array.from(memberCollection.values()).filter(m => !m.user?.bot);
  const audit = buildMemberMapAudit(members, players);
  const conflictRows = computeConflicts(audit);

  if (conflictRows.length === 0) {
    return interaction.editReply({ content: 'No conflicts left to resolve.' });
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
  return interaction.editReply({
    content: 'Select a conflict to resolve:',
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

export async function handleResolveAmbigButton(interaction) {
  const [, , adminId] = interaction.customId.split(':');
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  await interaction.deferReply({ ephemeral: true });
  const players = getTravianPlayersFromMap();
  let memberCollection;
  try {
    memberCollection = interaction.guild.members.cache.size > 0
      ? interaction.guild.members.cache
      : await interaction.guild.members.fetch();
  } catch (err) {
    logger.error('syncResolve: guild.members.fetch failed:', err.message);
    return interaction.editReply({ content: `❌ Could not fetch guild members: ${err.message}` });
  }
  const members = Array.from(memberCollection.values()).filter(m => !m.user?.bot);
  const audit = buildMemberMapAudit(members, players);
  const ambigRows = computeAmbiguous(audit).filter(r => !getPrimaryLinkForUser(r.discordId));

  if (ambigRows.length === 0) {
    return interaction.editReply({ content: 'No ambiguous members left to resolve.' });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`sync:pick-ambig:${adminId}`)
    .setPlaceholder('Pick an ambiguous member…')
    .addOptions(ambigRows.slice(0, 25).map(r =>
      new StringSelectMenuOptionBuilder()
        .setValue(r.discordId)
        .setLabel((r.displayName ?? r.discordId).slice(0, 100))
        .setDescription(`candidates: ${r.candidates.join(', ')}`.slice(0, 100))
    ));
  return interaction.editReply({
    content: 'Select a member to link:',
    components: [new ActionRowBuilder().addComponents(select)],
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

  const discordId = interaction.values[0];
  const modal = new ModalBuilder()
    .setCustomId(`sync:ambig-ign-modal:${adminId}:${discordId}`)
    .setTitle('Link IGN for member');
  const input = new TextInputBuilder()
    .setCustomId('ign')
    .setLabel('Travian in-game name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleAmbigIgnModal(interaction) {
  const parts = interaction.customId.split(':');
  const adminId = parts[2];
  const discordId = parts[3];
  const blocked = ensureSameAdmin(interaction, adminId);
  if (blocked) return blocked;

  const pickedIgn = interaction.fields.getTextInputValue('ign').trim();
  const result = applyAmbiguousPick({ discordId, pickedIgn });
  if (!result.ok) {
    const msg = result.reason === 'invalid_ign'
      ? `❌ \`${pickedIgn}\` isn't a player on the current map.`
      : `❌ ${result.reason}`;
    return interaction.reply({ content: msg, ephemeral: true });
  }
  if (result.next === 'done') {
    const member = await interaction.guild?.members.fetch(discordId).catch(() => null);
    let roleNote = '';
    if (member) {
      const roles = await assignRolesFromIgn({ member, ign: pickedIgn });
      const parts = [];
      if (roles.tribeAssigned) parts.push(`tribe role **${roles.tribeName}**`);
      if (roles.allianceAssigned) parts.push(`**${roles.allianceRoleName}** role`);
      if (parts.length) roleNote = ` ${parts.join(' and ')} assigned.`;
    }
    if (interaction.guild) {
      await renameOnboardingChannel(discordId, pickedIgn, interaction.guild);
      await updateOnboardingChannelTopic(discordId, pickedIgn, interaction.guild);
    }
    return interaction.reply({ content: `✅ Linked <@${discordId}> → **${pickedIgn}**.${roleNote}`, ephemeral: true });
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(pickedIgn)}:replace`).setLabel('Replace primary').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(pickedIgn)}:secondary`).setLabel('Add as secondary').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`sync:act:${adminId}:${discordId}:${encodeURIComponent(pickedIgn)}:skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  return interaction.reply({
    content: `<@${discordId}> already has a primary. Resolve **${pickedIgn}**:`,
    components: [row],
    ephemeral: true,
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
  let roleNote = '';
  if (action === 'replace') {
    const member = await interaction.guild?.members.fetch(discordId).catch(() => null);
    if (member) {
      const roles = await assignRolesFromIgn({ member, ign: targetIgn });
      const parts = [];
      if (roles.tribeAssigned) parts.push(`tribe role **${roles.tribeName}**`);
      if (roles.allianceAssigned) parts.push(`**${roles.allianceRoleName}** role`);
      if (parts.length) roleNote = ` ${parts.join(' and ')} assigned.`;
    }
    if (interaction.guild) {
      await renameOnboardingChannel(discordId, targetIgn, interaction.guild);
      await updateOnboardingChannelTopic(discordId, targetIgn, interaction.guild);
    }
  }
  return interaction.update({
    content: `✅ ${verb}: <@${discordId}> → **${targetIgn}**.${roleNote}`,
    components: [],
  });
}

