import { EmbedBuilder } from 'discord.js';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { setConfig, getConfig, exec, prepare, transaction, flushDb } from '../db/client.js';
import { deployPanel } from '../panel/deploy.js';
import { fetchMap } from '../jobs/mapFetch.js';
import { backupNow } from '../jobs/backup.js';
import { discordTimestamp } from '../utils/time.js';
import { snapshot } from '../utils/metrics.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { logger } from '../utils/logger.js';
import {
  buildMemberMapAudit,
  getTravianPlayersFromMap,
} from '../utils/memberMapMonitor.js';
import { adminLink, adminUnlink, adminSetPrimary, getAllLinksForUser, getPrimaryLinkForUser } from '../handlers/userIgnLinks.js';
import { upsertAccountFromMap } from '../handlers/travianAccounts.js';
import { buildSyncResolveButtons } from '../handlers/syncResolve.js';
import { normalizeIgn } from '../utils/ign.js';
import { applyCoordsAndDeriveTribe, renameOnboardingChannel, updateOnboardingChannelTopic } from '../handlers/onboarding.js';
import { assignRolesFromIgn, findUnlinkedTbds } from '../handlers/memberRoles.js';
import { applyMemberSyncRoles } from '../jobs/memberSync.js';
import { CREW_ROLE_NAMES } from '../utils/roleSelection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH  = process.env.DB_PATH || join(__dirname, '../../data/travian.db');
const LOG_DIR  = process.env.LOG_DIR || join(__dirname, '../../data/logs');
const SECRET_RE = /(token|password|secret|api[_-]?key)/i;
const MEMBER_SYNC_PREVIEW_LIMIT = 8;

function firstLines(lines, limit = MEMBER_SYNC_PREVIEW_LIMIT) {
  if (lines.length === 0) return '*None*';
  const shown = lines.slice(0, limit);
  const suffix = lines.length > limit ? `\n...and ${lines.length - limit} more` : '';
  return `${shown.join('\n')}${suffix}`;
}

function profileLinkLine(row) {
  const villages = Number(row.player.villages ?? 0).toLocaleString();
  const population = Number(row.player.population ?? 0).toLocaleString();
  return `<@${row.member.id}> -> **${row.player.player}** (${villages} villages, ${population} pop)`;
}

function ambiguousLine(row) {
  const names = row.players.map(player => player.player).join(' / ');
  return `<@${row.member.id}> **${row.displayName || row.member.id}** -> ${names}`;
}

function conflictLine(row) {
  return `<@${row.member.id}> has profile **${row.existingIgn}**, matched **${row.player.player}**`;
}

// Assign tribe + alliance roles for a user's new primary IGN, rename the
// onboarding channel, refresh its topic. Returns a short " ... assigned"
// suffix the slash-reply can append.
async function applyPrimaryIgnRoles(guild, discordId, ign) {
  if (!guild) return '';
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return '';
  try {
    const roles = await assignRolesFromIgn({ member, ign });
    const parts = [];
    if (roles.tribeAssigned) parts.push(`tribe role **${roles.tribeName}**`);
    if (roles.allianceAssigned) parts.push(`**${roles.allianceRoleName}** role`);
    await renameOnboardingChannel(discordId, ign, guild);
    await updateOnboardingChannelTopic(discordId, ign, guild);
    return parts.length ? ` ${parts.join(' and ')} assigned.` : '';
  } catch (err) {
    logger.warn(`applyPrimaryIgnRoles: ${discordId} / ${ign}: ${err.message}`);
    return '';
  }
}

export function applyMemberMapProfileMatches(audit) {
  const updated = [];
  const alreadyLinked = [];
  const conflicts = [];

  for (const row of audit.matched) {
    const discordId = row.member.id;
    const ign = row.player.player;
    const normalizedIgnInput = row.player.normalizedName ?? normalizeIgn(ign);

    const links = getAllLinksForUser(discordId);

    // Already linked to this exact account?
    if (links.some(l => l.normalized_ign === normalizedIgnInput)) {
      alreadyLinked.push(row);
      continue;
    }

    // Any other link? Then sync doesn't override — flag conflict.
    if (links.length > 0) {
      const primary = getPrimaryLinkForUser(discordId);
      conflicts.push({ ...row, existingIgn: primary?.ign ?? links[0].ign });
      continue;
    }

    // No links yet — create account + primary sync link.
    const run = transaction(() => {
      prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(discordId);
      upsertAccountFromMap(ign);
      prepare(`
        INSERT INTO user_ign_links (discord_id, ign, is_primary, source)
        VALUES (?, ?, 1, 'sync')
      `).run(discordId, ign);
    });
    run();
    updated.push(row);
  }

  return { updated, alreadyLinked, conflicts };
}

export function reportableUnmatchedRows(audit) {
  return (audit.unmatched ?? [])
    .filter(row => getAllLinksForUser(row.member.id).length === 0);
}

export async function handleSetup(interaction) {
  const type = interaction.options.getSubcommand();
  await deployPanel(interaction, type);
}

export async function handleAdmin(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'set-server') {
    const url = interaction.options.getString('url').replace(/\/$/, '');
    setConfig('server_url', url);
    return interaction.reply({ content: `✅ Server URL updated to \`${url}\``, ephemeral: true });
  }

  if (sub === 'reset-round') {
    await interaction.deferReply({ ephemeral: true });
    exec('DELETE FROM x_world');
    exec('DELETE FROM pledges');
    exec('DELETE FROM calls');
    logger.info('Round reset by', interaction.user.tag);
    return interaction.editReply({ content: '✅ Round data cleared. User profiles preserved.' });
  }

  if (sub === 'fetch-map') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const count = await fetchMap();
      return interaction.editReply({ content: `✅ Map fetched — ${count} villages loaded.` });
    } catch (err) {
      logger.error('Manual map fetch failed:', err.message);
      if (err.message === 'PRE_LAUNCH') {
        return interaction.editReply({ content: '📡 Map not yet available — server may be pre-launch.' });
      }
      if (err.message === 'EMPTY_RESPONSE') {
        return interaction.editReply({ content: '⚠️ Server returned empty/invalid map data. Existing data preserved.' });
      }
      return interaction.editReply({ content: `❌ Fetch failed: ${err.message}` });
    }
  }

  if (sub === 'map-status') {
    const countRow = prepare('SELECT COUNT(*) as c FROM x_world').get();
    const total = countRow?.c ?? 0;

    if (total === 0) {
      return interaction.reply({ content: 'No map data loaded yet.', ephemeral: true });
    }

    const serverUrl = getConfig('server_url') || process.env.TRAVIAN_SERVER_URL || '*not set*';
    const lastFetchAt = parseInt(getConfig('last_fetch_at') || '0', 10);
    const lastFetchCount = parseInt(getConfig('last_fetch_count') || '0', 10);

    const topAlliances = prepare(`
      SELECT alliance, COUNT(*) as c FROM x_world
      WHERE alliance IS NOT NULL AND alliance != ''
      GROUP BY alliance ORDER BY c DESC LIMIT 5
    `).all();

    const allianceList = topAlliances.length
      ? topAlliances.map((a, i) => `${i + 1}. **${a.alliance}** — ${a.c} villages`).join('\n')
      : '*No alliances found*';

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('🗺️ Map Data Status')
      .addFields(
        { name: 'Server',          value: serverUrl,                                          inline: false },
        { name: 'Last Fetch',      value: lastFetchAt ? discordTimestamp(lastFetchAt) : '*never*', inline: true },
        { name: 'Last Fetch Rows', value: String(lastFetchCount),                             inline: true },
        { name: 'Total Villages',  value: total.toLocaleString(),                             inline: true },
        { name: 'Top Alliances',   value: allianceList,                                       inline: false },
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'sync-members') {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.guild) {
      return interaction.editReply({ content: 'This command only works inside a Discord server.' });
    }

    const players = getTravianPlayersFromMap();
    if (players.length === 0) {
      return interaction.editReply({ content: 'No Travian map players loaded yet. Run `/admin fetch-map` first.' });
    }

    let memberCollection;
    try {
      memberCollection = await interaction.guild.members.fetch();
    } catch (err) {
      logger.error('Member sync failed to fetch guild members:', err);
      return interaction.editReply({
        content: 'Could not fetch Discord members. Enable the bot Server Members Intent in the Discord Developer Portal, then restart the bot.',
      });
    }

    const excluded = new Set(
      prepare('SELECT discord_id FROM sync_exclusions').all().map(r => r.discord_id),
    );
    const members = Array.from(memberCollection.values())
      .filter(member => !member.user?.bot && !excluded.has(member.id));
    const audit = buildMemberMapAudit(members, players);
    const unresolvedAmbiguous = audit.ambiguous.filter(row => !getPrimaryLinkForUser(row.member.id));
    const visibleUnmatched = reportableUnmatchedRows(audit);
    const updateProfiles = interaction.options.getBoolean('update-profiles') ?? true;
    const profileSync = updateProfiles
      ? applyMemberMapProfileMatches(audit)
      : { updated: [], alreadyLinked: [], conflicts: [] };

    const { rolesAssigned, flaggedTbd, flaggedMissingIgn } = await applyMemberSyncRoles({
      guild: interaction.guild,
      memberCollection,
      members,
      profileSync,
      excluded,
    });

    const unlinkedTbds = findUnlinkedTbds(interaction.guild, members);
    const anyFlagged = flaggedTbd.length + flaggedMissingIgn.length + unlinkedTbds.length;

    const embed = new EmbedBuilder()
      .setColor(anyFlagged > 0 ? COLORS.call.defense : COLORS.brand.info)
      .setTitle('Discord Member Map Sync')
      .setDescription(
        updateProfiles
          ? 'Matched Discord display names against Travian player names and filled missing bot profiles for unique matches.'
          : 'Matched Discord display names against Travian player names without updating bot profiles.',
      )
      .addFields(
        { name: 'Discord Members',    value: String(audit.totalMembers), inline: true },
        { name: 'Travian Players',    value: String(audit.totalPlayers), inline: true },
        { name: 'Unique Matches',     value: String(audit.matched.length), inline: true },
        { name: 'Profiles Updated',   value: String(profileSync.updated.length), inline: true },
        { name: 'Roles Assigned',     value: String(rolesAssigned), inline: true },
        { name: 'Already Linked',     value: String(profileSync.alreadyLinked.length), inline: true },
        { name: 'Profile Conflicts',  value: String(profileSync.conflicts.length), inline: true },
        { name: 'Ambiguous',          value: String(unresolvedAmbiguous.length), inline: true },
        { name: 'Unmatched',          value: String(visibleUnmatched.length), inline: true },
        { name: '⚠️ Flagged (TBD)',   value: String(flaggedTbd.length), inline: true },
        { name: '⚠️ Missing IGN',     value: String(flaggedMissingIgn.length), inline: true },
        { name: '🚨 Unlinked TBDs',   value: String(unlinkedTbds.length), inline: true },
      )
      .setFooter({ text: 'Matching ignores case, spaces, punctuation, symbols, and accents.' })
      .setTimestamp();

    if (profileSync.updated.length) {
      embed.addFields({
        name: 'Updated Profiles',
        value: firstLines(profileSync.updated.map(profileLinkLine)),
        inline: false,
      });
    } else if (!updateProfiles && audit.matched.length) {
      embed.addFields({
        name: 'Match Preview',
        value: firstLines(audit.matched.map(profileLinkLine)),
        inline: false,
      });
    }

    if (profileSync.conflicts.length) {
      embed.addFields({
        name: 'Profile Conflicts',
        value: firstLines(profileSync.conflicts.map(conflictLine)),
        inline: false,
      });
    }

    if (unresolvedAmbiguous.length) {
      embed.addFields({
        name: 'Ambiguous Names',
        value: firstLines(unresolvedAmbiguous.map(ambiguousLine)),
        inline: false,
      });
    }

    if (visibleUnmatched.length) {
      embed.addFields({
        name: 'Unmatched Members',
        value: firstLines(visibleUnmatched.map(row => `<@${row.member.id}> (${row.displayName})`)),
        inline: false,
      });
    }

    if (flaggedTbd.length) {
      embed.addFields({
        name: '⚠️ Newly Flagged (moved to TBD)',
        value: firstLines(flaggedTbd.map(f => `<@${f.discordId}> → **${f.ign}** (TBD)`)),
        inline: false,
      });
    }

    if (flaggedMissingIgn.length) {
      embed.addFields({
        name: '⚠️ Newly Flagged (IGN missing from map)',
        value: firstLines(flaggedMissingIgn.map(f => `<@${f.discordId}> → **${f.ign}** (gone from map)`)),
        inline: false,
      });
    }

    if (unlinkedTbds.length) {
      embed.addFields({
        name: '🚨 Unlinked TBDs (no IGN link)',
        value: firstLines(unlinkedTbds.map(m => `<@${m.id}> (${m.displayName})`))
          + '\n*Use `/admin link` to link or `/admin sync-exclude` to skip them in future runs.*',
        inline: false,
      });
    }

    logger.info(
      `Member sync by ${interaction.user.tag}: ${audit.matched.length} matched, ` +
      `${profileSync.updated.length} updated, ${unresolvedAmbiguous.length} ambiguous, ` +
      `${flaggedTbd.length} flagged TBD, ${flaggedMissingIgn.length} flagged missing IGN, ` +
      `${unlinkedTbds.length} unlinked TBDs, ${visibleUnmatched.length} unmatched`,
    );

    const resolveRow = buildSyncResolveButtons({
      adminId: interaction.user.id,
      conflicts: profileSync.conflicts.length,
      ambiguous: unresolvedAmbiguous.length,
    });
    const components = resolveRow ? [resolveRow] : [];
    return interaction.editReply({ embeds: [embed], components });
  }

  if (sub === 'link') {
    const target = interaction.options.getUser('discord');
    const ign    = interaction.options.getString('ign').trim();
    const result = adminLink(target.id, ign);
    if (!result.ok) {
      const msg = result.reason === 'not_found'
        ? `❌ \`${ign}\` isn't a player on the current map.`
        : result.reason === 'ambiguous'
          ? `❌ Multiple Travian players match \`${ign}\`. Use a more specific name.`
          : `❌ Could not link.`;
      return interaction.reply({ content: msg, ephemeral: true });
    }
    const label = result.isPrimary ? 'primary' : 'secondary';
    const roleNote = result.isPrimary
      ? await applyPrimaryIgnRoles(interaction.guild, target.id, result.canonical)
      : '';
    return interaction.reply({
      content: `✅ Linked <@${target.id}> ↔ **${result.canonical}** (${label}).${roleNote}`,
      ephemeral: true,
    });
  }

  if (sub === 'unlink') {
    const target = interaction.options.getUser('discord');
    const ign    = interaction.options.getString('ign').trim();
    const result = adminUnlink(target.id, ign);
    if (!result.ok) return interaction.reply({ content: '❌ That IGN isn\'t in the account table.', ephemeral: true });
    let extra = '';
    if (result.promotedPrimary) {
      const roleNote = await applyPrimaryIgnRoles(interaction.guild, target.id, result.promotedPrimary);
      extra = ` Primary is now **${result.promotedPrimary}**.${roleNote}`;
    }
    return interaction.reply({
      content: `✅ Unlinked <@${target.id}> from **${result.canonical}**.${extra}`,
      ephemeral: true,
    });
  }

  if (sub === 'set-primary') {
    const target = interaction.options.getUser('discord');
    const ign    = interaction.options.getString('ign').trim();
    const result = adminSetPrimary(target.id, ign);
    if (!result.ok) {
      const msg = result.reason === 'not_linked'
        ? `❌ <@${target.id}> isn't linked to **${ign}**.`
        : `❌ That IGN isn't in the account table.`;
      return interaction.reply({ content: msg, ephemeral: true });
    }
    const roleNote = await applyPrimaryIgnRoles(interaction.guild, target.id, result.canonical);
    return interaction.reply({
      content: `✅ Primary IGN for <@${target.id}> is now **${result.canonical}**.${roleNote}`,
      ephemeral: true,
    });
  }

  if (sub === 'set-welcome-channel') {
    const channel = interaction.options.getChannel('channel');
    setConfig('welcome_channel_id', channel.id);
    return interaction.reply({
      content: `✅ Welcome channel set to <#${channel.id}>. New members will be greeted there.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-notifications-channel') {
    const channel = interaction.options.getChannel('channel');
    setConfig('notifications_channel_id', channel.id);
    return interaction.reply({
      content: `✅ Notifications channel set to <#${channel.id}>. Sync results and map fetch errors will be posted there.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-onboarding-category') {
    const category = interaction.options.getChannel('category');
    setConfig('onboarding_category_id', category.id);
    return interaction.reply({
      content: `✅ Onboarding category set to **${category.name}**. A private channel will be created there for each new member.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-coords') {
    const target = interaction.options.getUser('discord');
    const coords = interaction.options.getString('coords').trim();
    const member = await interaction.guild?.members.fetch(target.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: `❌ Could not fetch member <@${target.id}>.`, ephemeral: true });
    }
    const result = await applyCoordsAndDeriveTribe({
      discordId: target.id, coordsString: coords, member,
    });
    if (!result.ok) {
      const msg = result.reason === 'invalid_coords'
        ? `❌ Invalid coords: \`${coords}\`. Try \`-12|34\`.`
        : result.reason === 'no_village'
          ? `❌ No village at \`${coords}\`. Run \`/admin fetch-map\` to refresh.`
          : result.reason === 'npc_village'
            ? `❌ \`${coords}\` is a Nature/Natars village.`
            : result.reason === 'wrong_owner'
              ? `❌ \`${coords}\` belongs to **${result.villageOwner}**, not <@${target.id}>'s linked IGN **${result.primaryIgn}**. Use \`/admin link\` first if this is a multi-IGN setup.`
              : result.reason === 'no_primary'
                ? `❌ <@${target.id}> has no linked IGN. Link them first with \`/admin link\`.`
                : '❌ Could not set coords.';
      return interaction.reply({ content: msg, ephemeral: true });
    }
    let roleNote = result.roleAssigned
      ? ` Tribe role **${result.tribeName}** assigned.`
      : ` Tribe is **${result.tribeName}** — Discord role missing on this server.`;
    if (result.allianceAssigned) roleNote += ` **${result.allianceRoleName}** role assigned.`;
    return interaction.reply({ content: `✅ Coords saved for <@${target.id}>.${roleNote}`, ephemeral: true });
  }

  if (sub === 'diag') {
    const m = snapshot();
    const mem = process.memoryUsage();
    let dbBytes = 0;
    try { dbBytes = statSync(DB_PATH).size; } catch {}

    const openCalls = prepare("SELECT COUNT(*) c FROM calls WHERE status = 'open'").get()?.c ?? 0;
    const totalCalls = prepare('SELECT COUNT(*) c FROM calls').get()?.c ?? 0;

    const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
    const fmtUptime = (s) => {
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m2 = Math.floor((s % 3600) / 60);
      return `${d}d ${h}h ${m2}m`;
    };

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand.info)
      .setTitle('🔧 Bot Diagnostics')
      .addFields(
        { name: 'Uptime',          value: fmtUptime(m.uptimeSec),  inline: true },
        { name: 'Memory (RSS)',    value: fmtMB(mem.rss),          inline: true },
        { name: 'Heap Used',       value: fmtMB(mem.heapUsed),     inline: true },
        { name: 'DB Size',         value: fmtMB(dbBytes),          inline: true },
        { name: 'Open Calls',      value: String(openCalls),       inline: true },
        { name: 'Total Calls',     value: String(totalCalls),      inline: true },
        { name: 'Map Fetches',     value: String(m.mapFetches),    inline: true },
        { name: 'Map Errors',      value: String(m.mapFetchErrors),inline: true },
        { name: 'Last Error',      value: m.lastErrorMessage ? `${m.lastErrorMessage.slice(0, 100)}\n*${discordTimestamp(Math.floor(m.lastErrorAt/1000), 'R')}*` : '*none*', inline: false },
        { name: 'Node Version',    value: process.version,         inline: true },
      )
      .setFooter({ text: FOOTER })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'tail-log') {
    const requested = interaction.options.getInteger('lines') ?? 50;
    const n = Math.min(Math.max(requested, 1), 200);
    const path = join(LOG_DIR, 'bot.log');
    if (!existsSync(path)) {
      return interaction.reply({ content: 'No log file yet.', ephemeral: true });
    }
    let text;
    try { text = readFileSync(path, 'utf8'); } catch (err) {
      return interaction.reply({ content: `❌ Could not read log: ${err.message}`, ephemeral: true });
    }
    const lines = text.split('\n').filter(Boolean).slice(-n)
      .map(l => SECRET_RE.test(l) ? '[REDACTED — line contained secret-like keyword]' : l);
    const block = lines.join('\n').slice(-1900);
    return interaction.reply({ content: `\`\`\`\n${block || '(empty)'}\n\`\`\``, ephemeral: true });
  }

  if (sub === 'db-vacuum') {
    await interaction.deferReply({ ephemeral: true });
    try {
      let beforeSize = 0;
      try { beforeSize = statSync(DB_PATH).size; } catch {}
      exec('VACUUM');
      flushDb();
      let afterSize = 0;
      try { afterSize = statSync(DB_PATH).size; } catch {}
      const fmt = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
      logger.info(`DB vacuumed by ${interaction.user.tag}: ${fmt(beforeSize)} → ${fmt(afterSize)}`);
      return interaction.editReply({ content: `✅ Vacuumed: ${fmt(beforeSize)} → ${fmt(afterSize)}` });
    } catch (err) {
      logger.error('Vacuum failed:', err);
      return interaction.editReply({ content: `❌ Vacuum failed: ${err.message}` });
    }
  }

  if (sub === 'backup-now') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const path = backupNow();
      return interaction.editReply({ content: path ? `✅ Backup written: \`${path}\`` : '⚠️ No DB to backup yet.' });
    } catch (err) {
      logger.error('Manual backup failed:', err);
      return interaction.editReply({ content: `❌ Backup failed: ${err.message}` });
    }
  }

  if (sub === 'check') {
    const target = interaction.options.getUser('discord');
    const links = getAllLinksForUser(target.id);
    if (links.length === 0) {
      return interaction.reply({ content: `<@${target.id}> has no linked IGN.`, ephemeral: true });
    }
    const acceptedAlliance = getConfig('accepted_alliance') ?? 'INV';
    const lines = links.map(link => {
      const village = prepare(
        `SELECT tid, alliance FROM x_world WHERE player = ? AND tid NOT IN (4, 5) LIMIT 1`,
      ).get(link.ign);
      const alliance = village?.alliance ?? '(none)';
      const isAccepted = village && alliance.toLowerCase() === acceptedAlliance.toLowerCase();
      const roleResult = !village
        ? '❌ not found in map'
        : isAccepted ? '✅ → **Accepted**' : '⚠️ → **TBD**';
      const primary = link.is_primary ? ' *(primary)*' : '';
      return `**${link.ign}**${primary} — alliance: \`${alliance}\` — ${roleResult}`;
    });
    return interaction.reply({
      content: `Profile check for <@${target.id}>:\n${lines.join('\n')}`,
      ephemeral: true,
    });
  }

  if (sub === 'onboarding-status') {
    await interaction.deferReply({ ephemeral: true });

    // Get all users with an onboarding channel
    const rows = prepare('SELECT discord_id, onboarding_channel_id FROM users WHERE onboarding_channel_id IS NOT NULL').all();

    if (rows.length === 0) {
      return interaction.editReply({ content: 'No onboarding channels found.' });
    }

    // Need guild to check crew roles
    if (!interaction.guild) {
      return interaction.editReply({ content: 'Must be run inside a server.' });
    }

    const lines = [];
    for (const row of rows) {
      const primary = getPrimaryLinkForUser(row.discord_id);

      // Fetch guild member to check crew roles
      const guildMember = await interaction.guild.members.fetch(row.discord_id).catch(() => null);

      // Member left the server — skip
      if (!guildMember) continue;

      const incomplete = [];
      if (!primary) incomplete.push('no IGN');
      else if (primary.home_x == null) incomplete.push('no coords');

      // Check crew role
      const memberRoleNames = Array.from(guildMember.roles.cache.values()).map(r => r.name);
      const hasCrew = CREW_ROLE_NAMES.some(crewName =>
        memberRoleNames.some(r => r.trim().toLowerCase() === crewName.trim().toLowerCase())
      );
      if (!hasCrew) incomplete.push('no crew role');

      if (incomplete.length === 0) continue; // fully onboarded — skip

      const channelRef = `<#${row.onboarding_channel_id}>`;
      lines.push(`<@${row.discord_id}> ${channelRef} — missing: ${incomplete.join(', ')}`);
    }

    if (lines.length === 0) {
      return interaction.editReply({ content: '✅ All members with onboarding channels have completed setup.' });
    }

    const content = `**Incomplete onboarding (${lines.length}):**\n${lines.join('\n')}`;
    return interaction.editReply({ content });
  }

  if (sub === 'sync-exclude') {
    const target = interaction.options.getUser('discord');
    prepare('INSERT OR IGNORE INTO sync_exclusions (discord_id) VALUES (?)').run(target.id);
    return interaction.reply({ content: `✅ <@${target.id}> excluded from automatic sync.`, ephemeral: true });
  }

  if (sub === 'sync-unexclude') {
    const target = interaction.options.getUser('discord');
    const result = prepare('DELETE FROM sync_exclusions WHERE discord_id = ?').run(target.id);
    const msg = result.changes > 0
      ? `✅ <@${target.id}> removed from sync exclusion list.`
      : `ℹ️ <@${target.id}> wasn't on the exclusion list.`;
    return interaction.reply({ content: msg, ephemeral: true });
  }

  if (sub === 'sync-excluded-list') {
    const rows = prepare('SELECT discord_id FROM sync_exclusions ORDER BY added_at').all();
    const content = rows.length
      ? `**Excluded from sync (${rows.length}):**\n${rows.map(r => `<@${r.discord_id}>`).join('\n')}`
      : 'No members are currently excluded from sync.';
    return interaction.reply({ content, ephemeral: true });
  }

  if (sub === 'map-search') {
    const ign = interaction.options.getString('ign').trim();
    const rows = prepare(`
      SELECT player, alliance, tid, COUNT(*) as villages
      FROM x_world
      WHERE tid NOT IN (4, 5) AND lower(player) LIKE lower(?)
      GROUP BY player, alliance, tid
      ORDER BY villages DESC
      LIMIT 10
    `).all(`%${ign}%`);
    if (rows.length === 0) {
      return interaction.reply({ content: `No players found matching \`${ign}\`.`, ephemeral: true });
    }
    const acceptedAlliance = getConfig('accepted_alliance') ?? 'INV';
    const lines = rows.map(r => {
      const alliance = r.alliance ?? '(none)';
      const isAccepted = alliance.toLowerCase() === acceptedAlliance.toLowerCase();
      const roleResult = isAccepted ? '✅ Accepted' : '⚠️ TBD';
      const tribeNames = { 1: 'Romans', 2: 'Teutons', 3: 'Gauls', 6: 'Egyptians', 7: 'Huns', 8: 'Spartans' };
      const tribe = tribeNames[r.tid] ?? `tid:${r.tid}`;
      return `**${r.player}** — alliance: \`${alliance}\` — ${tribe} — ${r.villages} village${r.villages !== 1 ? 's' : ''} — ${roleResult}`;
    });
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }
}
