import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prepare } from '../db/client.js';
import { formatAmount } from '../utils/resources.js';
import { logger } from '../utils/logger.js';

const PAGE_SIZE = 20;
const MEDALS = ['🥇', '🥈', '🥉'];

function pledgeTotalsByUser() {
  const rows = prepare(`
    SELECT pledges.user_id, SUM(CAST(pledges.amount AS INTEGER)) AS total, COUNT(*) AS pushes
    FROM pledges
    JOIN calls ON calls.id = pledges.call_id
    WHERE calls.type LIKE 'push:%'
    GROUP BY pledges.user_id
  `).all();
  return new Map(rows.map(r => [r.user_id, { total: r.total, pushes: r.pushes }]));
}

// Builds the full roster for a set of Discord member IDs, defaulting anyone
// with no pledges to 0/0 so zero-pushers stay visible, sorted by total desc.
export function buildResourceRoster(memberIds) {
  const totals = pledgeTotalsByUser();
  const roster = memberIds.map(id => {
    const t = totals.get(id) ?? { total: 0, pushes: 0 };
    return { user_id: id, total: t.total, pushes: t.pushes };
  });
  roster.sort((a, b) => b.total - a.total || b.pushes - a.pushes);
  return roster;
}

function rankLine(rank, row) {
  const prefix = MEDALS[rank] ?? `${rank + 1}.`;
  return `${prefix} <@${row.user_id}> — ${formatAmount(row.total)} (${row.pushes} push${row.pushes === 1 ? '' : 'es'})`;
}

export function buildResourceRosterPayload(roster, offset = 0) {
  const total = roster.length;
  const pageRows = roster.slice(offset, offset + PAGE_SIZE);
  const pageNum = Math.floor(offset / PAGE_SIZE) + 1;
  const pageMax = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const description = pageRows.length
    ? pageRows.map((r, i) => rankLine(offset + i, r)).join('\n')
    : '*No members found*';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🏆 Lifetime Resource Contributions (page ${pageNum}/${pageMax})`)
    .setDescription(description)
    .setFooter({ text: `${total} member${total === 1 ? '' : 's'}` })
    .setTimestamp();

  const prevDisabled = offset === 0;
  const nextDisabled = offset + PAGE_SIZE >= total;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`report:roster:page:${Math.max(0, offset - PAGE_SIZE)}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(`report:roster:page:${offset + PAGE_SIZE}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Next')
      .setEmoji('➡️')
      .setDisabled(nextDisabled),
  );

  return { embeds: [embed], components: [row] };
}

async function buildRosterPageForGuild(guild, offset) {
  let memberCollection;
  try {
    memberCollection = await guild.members.fetch();
  } catch (err) {
    logger.error('resource-roster: failed to fetch guild members:', err);
    return {
      embeds: [new EmbedBuilder().setDescription(`Could not fetch Discord members: \`${err.message}\`. If this is the first time, enable the Server Members Intent in the Discord Developer Portal, then restart the bot.`)],
      components: [],
    };
  }
  const memberIds = Array.from(memberCollection.values())
    .filter(m => !m.user?.bot)
    .map(m => m.id);
  const roster = buildResourceRoster(memberIds);
  return buildResourceRosterPayload(roster, offset);
}

export async function handleResourceRosterCommand(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'This command only works inside a Discord server.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const payload = await buildRosterPageForGuild(interaction.guild, 0);
  return interaction.editReply(payload);
}

export async function handleResourceRosterPage(interaction) {
  // report:roster:page:<offset>
  const offset = parseInt(interaction.customId.split(':')[3], 10) || 0;
  const payload = await buildRosterPageForGuild(interaction.guild, offset);
  return interaction.update(payload);
}
