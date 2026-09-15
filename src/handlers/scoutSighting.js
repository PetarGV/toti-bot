import {
  EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { logger } from '../utils/logger.js';
import { ensureScoutInfrastructure } from '../utils/scoutChannels.js';

// ── Button entry: intel:report ────────────────────────────────────────────────
export async function handleReportSightingButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('intel:report:submit')
    .setTitle('Report Sighting');

  const coordsInput = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Village coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('(-12|34)')
    .setMaxLength(20);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('What did you see?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('Troop counts, movement, building activity, etc.')
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(notesInput),
  );
  await interaction.showModal(modal);
}

// ── Modal submit: intel:report:submit ─────────────────────────────────────────
export async function handleReportSightingModal(interaction) {
  const coordsStr = interaction.fields.getTextInputValue('coords');
  const notes = interaction.fields.getTextInputValue('notes').trim();

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: `❌ Invalid coordinates: \`${coordsStr}\`.`, ephemeral: true });
  }
  if (!notes) {
    return interaction.reply({ content: '❌ Sighting notes cannot be empty.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  let archiveChannel;
  try {
    ({ archiveChannel } = await ensureScoutInfrastructure(interaction.guild));
  } catch (err) {
    logger.warn('Report sighting: could not prepare scout archive channel:', err.message);
    return interaction.editReply({ content: `❌ Could not post sighting: ${err.message}` });
  }

  const target = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(coords.x, coords.y) || null;

  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('📍 Sighting Report')
    .addFields(
      { name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Coords', value: `[${formatCoords(coords.x, coords.y)}](${mapUrl(coords.x, coords.y)})`, inline: true },
    )
    .setTimestamp();

  if (target?.player) {
    embed.addFields({ name: 'Target', value: `${target.player}${target.alliance ? ` [${target.alliance}]` : ''}`, inline: true });
  }
  embed.addFields({ name: 'Notes', value: notes, inline: false });

  try {
    await archiveChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn('Report sighting: failed to post to archive channel:', err.message);
    return interaction.editReply({ content: `❌ Could not post sighting: ${err.message}` });
  }

  return interaction.editReply({ content: `✅ Sighting posted to <#${archiveChannel.id}>.` });
}
