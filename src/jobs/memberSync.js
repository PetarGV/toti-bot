import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { prepare, setConfig } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { getTravianPlayersFromMap, buildMemberMapAudit } from '../utils/memberMapMonitor.js';
import { getPrimaryLinkForUser } from '../handlers/userIgnLinks.js';
import { applyMemberMapProfileMatches } from '../commands/admin.js';
import { assignRolesFromIgn, findUnlinkedTbds } from '../handlers/memberRoles.js';
import { renameOnboardingChannel, flagOnboardingChannel } from '../handlers/onboarding.js';
import { getPrimaryGuild, getNotificationsChannel } from '../utils/guild.js';
import { unixNow } from '../utils/time.js';

// Refresh roles for a single (member, ign) pair and report whether the
// member transitioned to TBD or whose IGN has vanished from x_world.
//
// Returns: { rolesAssigned, transitionedToTbd, ignMissingFromMap }
//   The two boolean flags track the *role transition itself*, not whether
//   the onboarding channel was successfully flagged. Many older members
//   have no onboarding channel, but their TBD transitions still need to be
//   reported. Channel flagging is a best-effort side-effect.
//
// checkMapPresence=true for the "all-primary-links" loop where the IGN may
// have disappeared from the map. Skip it for audit-matched rows since those
// IGNs are guaranteed to be in x_world.
export async function refreshSyncMember({ member, ign, guild, checkMapPresence }) {
  if (checkMapPresence) {
    const exists = prepare(
      'SELECT 1 FROM x_world WHERE player IS NOT NULL AND lower(player) = lower(?) LIMIT 1',
    ).get(ign);
    if (!exists) {
      await flagOnboardingChannel(
        member.id,
        `**${ign}** is no longer in the map data (account deleted or wiped)`,
        guild,
      );
      return { rolesAssigned: false, transitionedToTbd: false, ignMissingFromMap: true };
    }
  }

  try {
    const roles = await assignRolesFromIgn({ member, ign });
    const rolesAssigned = roles.tribeAssigned || roles.allianceAssigned;
    let transitionedToTbd = false;
    if (roles.allianceAssigned && roles.allianceRoleName === 'TBD') {
      transitionedToTbd = true;
      await flagOnboardingChannel(
        member.id,
        `**${ign}** moved to **TBD** — no longer in the alliance`,
        guild,
      );
    }
    return { rolesAssigned, transitionedToTbd, ignMissingFromMap: false };
  } catch (err) {
    logger.warn(`refreshSyncMember: ${member.id} / ${ign}: ${err.message}`);
    return { rolesAssigned: false, transitionedToTbd: false, ignMissingFromMap: false };
  }
}

// Runs both the audit-matched loop and the all-primary-links loop, plus the
// channel renames. Returns structured results so callers (cron + admin) can
// present them how they like.
export async function applyMemberSyncRoles({ guild, memberCollection, members, profileSync, excluded }) {
  let rolesAssigned = 0;
  const flaggedTbd = [];          // [{ discordId, displayName, ign }]
  const flaggedMissingIgn = [];   // same shape

  // Loop 1: audit-matched + already-linked rows.
  //
  // Prefer the user's PRIMARY ign over the audit match. The audit matches
  // on "Discord display name CONTAINS player name" which can hit the wrong
  // account when names overlap — e.g. display "ZoDiack" contains "Dia"
  // but not "ZoDiak", so a dual-account player whose real main is ZoDiak
  // would otherwise get role-assigned based on Dia.
  for (const row of [...profileSync.updated, ...profileSync.alreadyLinked]) {
    const primary = getPrimaryLinkForUser(row.member.id);
    const ign = primary?.ign ?? row.player.player;
    const r = await refreshSyncMember({
      member: row.member,
      ign,
      guild,
      checkMapPresence: true,
    });
    if (r.rolesAssigned) rolesAssigned++;
    if (r.transitionedToTbd) {
      flaggedTbd.push({
        discordId: row.member.id,
        displayName: row.member.displayName,
        ign,
      });
    }
    if (r.ignMissingFromMap) {
      flaggedMissingIgn.push({
        discordId: row.member.id,
        displayName: row.member.displayName,
        ign,
      });
    }
  }

  // Rename private onboarding channels for newly linked members
  for (const row of profileSync.updated) {
    await renameOnboardingChannel(row.member.id, row.player.player, guild);
  }

  // Loop 2: every primary link in the DB not already touched by loop 1
  const processedIds = new Set([
    ...profileSync.updated.map(r => r.member.id),
    ...profileSync.alreadyLinked.map(r => r.member.id),
  ]);
  const allPrimaryLinks = prepare(
    'SELECT discord_id, ign FROM user_ign_links WHERE is_primary = 1',
  ).all();
  for (const link of allPrimaryLinks) {
    if (processedIds.has(link.discord_id) || excluded.has(link.discord_id)) continue;
    const discordMember = memberCollection.get(link.discord_id);
    if (!discordMember) continue; // member left the server

    const r = await refreshSyncMember({
      member: discordMember,
      ign: link.ign,
      guild,
      checkMapPresence: true,
    });
    if (r.rolesAssigned) rolesAssigned++;
    if (r.transitionedToTbd) {
      flaggedTbd.push({
        discordId: discordMember.id,
        displayName: discordMember.displayName,
        ign: link.ign,
      });
    }
    if (r.ignMissingFromMap) {
      flaggedMissingIgn.push({
        discordId: discordMember.id,
        displayName: discordMember.displayName,
        ign: link.ign,
      });
    }
  }

  return { rolesAssigned, flaggedTbd, flaggedMissingIgn };
}

export async function runMemberSync(client) {
  const guild = getPrimaryGuild(client);
  if (!guild) {
    logger.warn('memberSync: no guild in cache — skipping');
    return;
  }

  const players = getTravianPlayersFromMap();
  if (players.length === 0) {
    logger.info('memberSync: no map data — skipping');
    return;
  }

  let memberCollection;
  try {
    memberCollection = await guild.members.fetch();
  } catch (err) {
    logger.error('memberSync: failed to fetch guild members:', err.message);
    return;
  }

  const excluded = new Set(
    prepare('SELECT discord_id FROM sync_exclusions').all().map(r => r.discord_id),
  );
  const members = Array.from(memberCollection.values())
    .filter(m => !m.user?.bot && !excluded.has(m.id));
  const audit = buildMemberMapAudit(members, players);
  const profileSync = applyMemberMapProfileMatches(audit);
  const unresolvedAmbiguous = audit.ambiguous.filter(row => !getPrimaryLinkForUser(row.member.id));

  const { rolesAssigned, flaggedTbd, flaggedMissingIgn } = await applyMemberSyncRoles({
    guild, memberCollection, members, profileSync, excluded,
  });
  const flaggedCount = flaggedTbd.length + flaggedMissingIgn.length;
  const unlinkedTbds = findUnlinkedTbds(guild, members);

  setConfig('last_sync_at', unixNow());

  logger.info(
    `memberSync: ${audit.matched.length} matched, ${profileSync.updated.length} new links, ` +
    `${rolesAssigned} roles assigned, ${flaggedCount} flagged (${flaggedTbd.length} TBD, ${flaggedMissingIgn.length} missing IGN), ` +
    `${unresolvedAmbiguous.length} ambiguous, ${unlinkedTbds.length} unlinked TBDs, ${audit.unmatched.length} unmatched`,
  );

  const hasChanges =
    profileSync.updated.length > 0 ||
    rolesAssigned > 0 ||
    flaggedCount > 0 ||
    unlinkedTbds.length > 0;
  if (!hasChanges) return;

  const notifChannel = getNotificationsChannel(guild);
  if (!notifChannel) {
    logger.warn('memberSync: notifications channel not configured — skipping notification');
    return;
  }

  const lines = profileSync.updated.map(
    row => `<@${row.member.id}> → **${row.player.player}**`,
  );

  const embed = new EmbedBuilder()
    .setColor((flaggedCount > 0 || unlinkedTbds.length > 0) ? COLORS.call.defense : COLORS.brand.info)
    .setTitle('🔄 Scheduled Member Sync')
    .addFields(
      { name: 'New Links',         value: String(profileSync.updated.length), inline: true },
      { name: 'Roles Assigned',    value: String(rolesAssigned),              inline: true },
      { name: 'Ambiguous',         value: String(unresolvedAmbiguous.length), inline: true },
      { name: '⚠️ Flagged (TBD)',  value: String(flaggedTbd.length),          inline: true },
      { name: '⚠️ Missing IGN',    value: String(flaggedMissingIgn.length),   inline: true },
      { name: '🚨 Unlinked TBDs',  value: String(unlinkedTbds.length),        inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (lines.length) {
    const shown = lines.slice(0, 10);
    const extra = lines.length > 10 ? `\n…and ${lines.length - 10} more` : '';
    embed.addFields({ name: 'Newly Linked', value: shown.join('\n') + extra });
  }

  if (flaggedTbd.length) {
    const fLines = flaggedTbd.map(f => `<@${f.discordId}> → **${f.ign}** (TBD)`);
    const shown = fLines.slice(0, 10);
    const extra = fLines.length > 10 ? `\n…and ${fLines.length - 10} more` : '';
    embed.addFields({
      name: '⚠️ Newly Flagged (moved to TBD)',
      value: shown.join('\n') + extra,
    });
  }

  if (flaggedMissingIgn.length) {
    const fLines = flaggedMissingIgn.map(f => `<@${f.discordId}> → **${f.ign}** (gone from map)`);
    const shown = fLines.slice(0, 10);
    const extra = fLines.length > 10 ? `\n…and ${fLines.length - 10} more` : '';
    embed.addFields({
      name: '⚠️ Newly Flagged (IGN missing from map)',
      value: shown.join('\n') + extra,
    });
  }

  if (unlinkedTbds.length) {
    const tbdLines = unlinkedTbds.map(m => `<@${m.id}> (${m.displayName})`);
    const shown = tbdLines.slice(0, 10);
    const extra = tbdLines.length > 10 ? `\n…and ${tbdLines.length - 10} more` : '';
    embed.addFields({
      name: '🚨 Unlinked TBDs (no IGN link)',
      value: shown.join('\n') + extra + '\n*Use `/admin link` to link or `/admin sync-exclude` to skip them in future runs.*',
    });
  }

  try {
    await notifChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.error('memberSync: failed to send notification:', err.message);
  }
}

export function startMemberSyncJob(client) {
  // Run at 06:30 and 18:30 every day — 30 min after map fetch to avoid race
  cron.schedule('30 6,18 * * *', async () => {
    try {
      await runMemberSync(client);
    } catch (err) {
      logger.error('memberSync: job crashed:', err.message);
    }
  });
  logger.info('Member sync job scheduled at 06:30 and 18:30 UTC daily');
}
