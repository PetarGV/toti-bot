import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { getConfig, prepare } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { getTravianPlayersFromMap, buildMemberMapAudit } from '../utils/memberMapMonitor.js';
import { getPrimaryLinkForUser } from '../handlers/userIgnLinks.js';
import { applyMemberMapProfileMatches } from '../commands/admin.js';
import { assignRolesFromIgn } from '../handlers/memberRoles.js';
import { renameOnboardingChannel } from '../handlers/onboarding.js';

async function runMemberSync(client) {
  const guild = client.guilds.cache.first();
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

  let rolesAssigned = 0;
  for (const row of [...profileSync.updated, ...profileSync.alreadyLinked]) {
    try {
      const roles = await assignRolesFromIgn({ member: row.member, ign: row.player.player });
      if (roles.tribeAssigned || roles.allianceAssigned) rolesAssigned++;
    } catch (err) {
      logger.warn(`memberSync: role assignment failed for ${row.member.id}: ${err.message}`);
    }
  }

  // Rename private onboarding channels for newly linked members
  for (const row of profileSync.updated) {
    await renameOnboardingChannel(row.member.id, row.player.player, guild);
  }

  logger.info(
    `memberSync: ${audit.matched.length} matched, ${profileSync.updated.length} new links, ` +
    `${rolesAssigned} roles assigned, ${unresolvedAmbiguous.length} ambiguous, ${audit.unmatched.length} unmatched`,
  );

  const hasChanges = profileSync.updated.length > 0 || rolesAssigned > 0;
  if (!hasChanges) return;

  const notifChannel = guild.channels.cache.find(
    c => c.name === 'bot-notifications' && c.isTextBased?.(),
  );
  if (!notifChannel) {
    logger.warn('memberSync: #bot-notifications channel not found — skipping notification');
    return;
  }

  const lines = profileSync.updated.map(
    row => `<@${row.member.id}> → **${row.player.player}**`,
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand.info)
    .setTitle('🔄 Scheduled Member Sync')
    .addFields(
      { name: 'New Links',      value: String(profileSync.updated.length), inline: true },
      { name: 'Roles Assigned', value: String(rolesAssigned),              inline: true },
      { name: 'Ambiguous',      value: String(unresolvedAmbiguous.length), inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (lines.length) {
    const shown = lines.slice(0, 10);
    const extra = lines.length > 10 ? `\n…and ${lines.length - 10} more` : '';
    embed.addFields({ name: 'Newly Linked', value: shown.join('\n') + extra });
  }

  try {
    await notifChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.error('memberSync: failed to send notification:', err.message);
  }
}

export function startMemberSyncJob(client) {
  // Run at 06:00 and 18:00 every day (12-hour interval)
  cron.schedule('0 6,18 * * *', async () => {
    try {
      await runMemberSync(client);
    } catch (err) {
      logger.error('memberSync: job crashed:', err.message);
    }
  });
  logger.info('Member sync job scheduled at 06:00 and 18:00 UTC daily');
}
