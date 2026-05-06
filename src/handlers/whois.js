import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { getTribe } from '../utils/tribes.js';

export async function handleWhoisCommand(interaction) {
  const coords = interaction.options.getString('coords');
  await renderWhois(interaction, coords);
}

export async function handleWhoisButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('whois:lookup')
    .setTitle('Whois Lookup');

  const input = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Coordinates')
    .setPlaceholder('e.g. -10|25')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleWhoisModalSubmit(interaction) {
  const coords = interaction.fields.getTextInputValue('coords');
  await renderWhois(interaction, coords);
}

async function renderWhois(interaction, coordsInput) {
  const coords = parseCoords(coordsInput);
  if (!coords) {
    return interaction.reply({
      content: '❌ Invalid coordinates. Use format like (x|y), x|y, or x/y.',
      ephemeral: true,
    });
  }

  const countRow = prepare('SELECT COUNT(*) as c FROM x_world').get();
  if (!countRow || countRow.c === 0) {
    return interaction.reply({
      content: '📡 Map data not yet loaded. The server may not be live yet, or run `/admin fetch-map` to load it.',
      ephemeral: true,
    });
  }

  const village = prepare('SELECT * FROM x_world WHERE x = ? AND y = ?').get(coords.x, coords.y);
  if (!village) {
    return interaction.reply({
      content: `🗺️ No village found at ${formatCoords(coords.x, coords.y)}. Coordinates may be empty terrain.`,
      ephemeral: true,
    });
  }

  const tribe = getTribe(village.tid);
  const isNature = village.tid === 4;
  const isUnoccupied = !village.uid;

  const embed = new EmbedBuilder().setColor(0x3498db);

  if (isNature) {
    embed.setTitle(`🌳 ${village.village} (Oasis)`);
  } else if (isUnoccupied) {
    embed.setTitle(`🏚️ ${village.village} (Unoccupied)`);
  } else {
    embed.setTitle(`${tribe.emoji} ${village.village}`);
  }

  embed.addFields({
    name: 'Coordinates',
    value: formatCoords(village.x, village.y),
    inline: true,
  });

  if (!isNature && !isUnoccupied) {
    embed.addFields({ name: 'Tribe', value: tribe.name, inline: true });
  }

  embed.addFields(
    { name: 'Player',     value: village.player   ?? '*Unoccupied*', inline: true },
    { name: 'Alliance',   value: village.alliance ?? '*None*',       inline: true },
    { name: 'Population', value: Number(village.population).toLocaleString(), inline: true },
  );

  if (village.fetched_at) {
    embed.setFooter({ text: 'Map data updated' }).setTimestamp(new Date(village.fetched_at * 1000));
  }

  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open on map')
      .setEmoji('🗺️')
      .setStyle(ButtonStyle.Link)
      .setURL(mapUrl(village.x, village.y)),
  );

  return interaction.reply({ embeds: [embed], components: [linkRow] });
}