import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prepare } from '../db/client.js';
import { getProfile } from './profile.js';
import { formatCoords } from '../utils/coords.js';
import { discordTimestamp } from '../utils/time.js';
import { getTribe } from '../utils/tribes.js';
import { COLORS, FOOTER, callTypeLabel } from '../utils/i18n.js';
import { getDualsForUser } from '../utils/ign.js';

async function renderStatus(interaction) {
  const userId  = interaction.user.id;
  const guildId = interaction.guildId;
  const profile = getProfile(userId);

  const openCalls = prepare(
    "SELECT * FROM calls WHERE author_id = ? AND status = 'open' ORDER BY deadline IS NULL, deadline ASC LIMIT 10"
  ).all(userId);

  const myPledges = prepare(`
    SELECT pledges.amount, calls.*
    FROM pledges JOIN calls ON pledges.call_id = calls.id
    WHERE pledges.user_id = ? AND calls.status = 'open'
    ORDER BY calls.deadline IS NULL, calls.deadline ASC
    LIMIT 10
  `).all(userId);

  const lifetimeRows = prepare(`
    SELECT calls.type
    FROM pledges JOIN calls ON pledges.call_id = calls.id
    WHERE pledges.user_id = ?
  `).all(userId);

  const lifetimeCounts = {};
  for (const row of lifetimeRows) {
    const prefix = row.type.split(':')[0];
    lifetimeCounts[prefix] = (lifetimeCounts[prefix] ?? 0) + 1;
  }

  const tribeMeta = profile?.tribe ? getTribe(profile.tribe) : null;
  const duals = getDualsForUser(userId);
  const profileLines = [
    `**IGN:** ${profile?.ign ?? '*not set*'}`,
    `**Home:** ${profile?.home_x != null ? formatCoords(profile.home_x, profile.home_y) : '*not set*'}`,
    `**Tribe:** ${tribeMeta ? `${tribeMeta.emoji} ${tribeMeta.name}` : '*not set*'}`,
  ];
  if (duals.length) {
    profileLines.push(`**Shared with:** ${duals.map(d => `<@${d.discord_id}>`).join(', ')}`);
  }

  const callLines = openCalls.length
    ? openCalls.map(c => {
        const jump = `https://discord.com/channels/${guildId}/${c.channel_id}/${c.message_id}`;
        const dl   = c.deadline ? discordTimestamp(c.deadline, 'R') : '*no deadline*';
        return `• **${c.type}** ${formatCoords(c.x, c.y)} — ${dl} — [Jump](${jump})`;
      })
    : ['*None*'];

  const pledgeLines = myPledges.length
    ? myPledges.map(c => {
        const jump = `https://discord.com/channels/${guildId}/${c.channel_id}/${c.message_id}`;
        const dl   = c.deadline ? discordTimestamp(c.deadline, 'R') : '*no deadline*';
        return `• **${c.type}** ${formatCoords(c.x, c.y)} — ${dl} — [Jump](${jump})`;
      })
    : ['*None*'];

  const statsLines = Object.keys(lifetimeCounts).length
    ? Object.entries(lifetimeCounts).map(([t, n]) => `${t}: ${n}`).join(', ')
    : '*No pledges yet*';

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand.primary)
    .setTitle('📊 My Status Dashboard')
    .addFields(
      { name: 'Profile',        value: profileLines.join('\n'), inline: false },
      { name: 'My Open Calls',  value: callLines.join('\n'),    inline: false },
      { name: 'My Pledges',     value: pledgeLines.join('\n'),  inline: false },
      { name: 'Lifetime Stats', value: statsLines,              inline: false },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  const notifyOn = profile?.notify_pledges === 1;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('notify:toggle')
      .setStyle(ButtonStyle.Secondary)
      .setLabel(notifyOn ? 'DMs ON' : 'DMs OFF')
      .setEmoji(notifyOn ? '🔔' : '🔕'),
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

export async function handleStatusCommand(interaction) {
  const payload = await renderStatus(interaction);
  await interaction.reply(payload);
}

export async function handleStatusButton(interaction) {
  const payload = await renderStatus(interaction);
  await interaction.reply(payload);
}