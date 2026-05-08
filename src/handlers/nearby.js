import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { getTribe } from '../utils/tribes.js';
import {
  findNearbyVillages,
  getLastMapFetchedAt,
  getMapDataCount,
  normalizeNearbyOptions,
} from '../utils/mapSearch.js';

const MODAL_ID = 'nearby:lookup';

export async function handleNearbyCommand(interaction) {
  const coords = interaction.options.getString('coords');
  const radius = interaction.options.getInteger('radius');
  const limit = interaction.options.getInteger('limit');
  return renderNearby(interaction, coords, { radius, limit });
}

export async function handleNearbyButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Nearby Map');

  const coordsInput = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Coordinates')
    .setPlaceholder('e.g. -10|25')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const radiusInput = new TextInputBuilder()
    .setCustomId('radius')
    .setLabel('Radius in fields')
    .setPlaceholder('Default: 10, max: 50')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  const limitInput = new TextInputBuilder()
    .setCustomId('limit')
    .setLabel('Result limit')
    .setPlaceholder('Default: 10, max: 20')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(radiusInput),
    new ActionRowBuilder().addComponents(limitInput),
  );

  return interaction.showModal(modal);
}

export async function handleNearbyModalSubmit(interaction) {
  const coords = interaction.fields.getTextInputValue('coords');
  const radius = parseOptionalInteger('Radius', interaction.fields.getTextInputValue('radius'));
  const limit = parseOptionalInteger('Limit', interaction.fields.getTextInputValue('limit'));

  if (radius.error) {
    return interaction.reply({ content: radius.error, ephemeral: true });
  }
  if (limit.error) {
    return interaction.reply({ content: limit.error, ephemeral: true });
  }

  return renderNearby(interaction, coords, { radius: radius.value, limit: limit.value });
}

function parseOptionalInteger(label, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { value: null };
  if (!/^[1-9]\d*$/.test(value)) {
    return { error: `${label} must be a whole number.` };
  }
  return { value: Number(value) };
}

async function renderNearby(interaction, coordsInput, rawOptions = {}) {
  const coords = parseCoords(coordsInput);
  if (!coords) {
    return interaction.reply({
      content: 'Invalid coordinates. Use format like (x|y), x|y, or x/y.',
      ephemeral: true,
    });
  }

  if (getMapDataCount() === 0) {
    return interaction.reply({
      content: 'Map data not yet loaded. Run `/admin fetch-map` to load it.',
      ephemeral: true,
    });
  }

  const options = normalizeNearbyOptions(rawOptions);
  const result = findNearbyVillages(coords, options);

  if (!result.centerVillage && result.villages.length === 0) {
    return interaction.reply({
      content: `No villages found within ${result.radius} fields of ${formatCoords(coords.x, coords.y)}.`,
      ephemeral: true,
    });
  }

  const fetchedAt = getLastMapFetchedAt();
  const embed = buildNearbyEmbed(coords, result, fetchedAt);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

export function buildNearbyEmbed(center, result, fetchedAt) {
  const shown = (result.centerVillage ? 1 : 0) + result.villages.length;
  const sections = [];

  if (result.centerVillage) {
    sections.push(`**Center village**\n${formatVillageLine(result.centerVillage)}`);
  }

  if (result.villages.length) {
    const nearbyLines = result.villages.map((row, index) => formatVillageLine(row, index + 1));
    sections.push(`**Nearby villages**\n${nearbyLines.join('\n')}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Nearby villages around ${formatCoords(center.x, center.y)}`)
    .setDescription(sections.join('\n\n'))
    .addFields(
      { name: 'Search center', value: formatCoords(center.x, center.y), inline: true },
      { name: 'Radius', value: `${result.radius} fields`, inline: true },
      { name: 'Shown', value: String(shown), inline: true },
      { name: 'Found in radius', value: String(result.totalInRadius), inline: true },
    );

  if (fetchedAt) {
    embed.setFooter({ text: 'Map data updated' }).setTimestamp(new Date(fetchedAt * 1000));
  }

  return embed;
}

function formatVillageLine(row, index = null) {
  const prefix = index == null ? '' : `${index}. `;
  const coords = `[${formatCoords(row.x, row.y)}](${mapUrl(row.x, row.y)})`;
  const distance = `${Number(row.distance ?? 0).toFixed(1)} fields`;
  const village = row.village || 'Unnamed village';
  const player = row.player || 'Unoccupied';
  const alliance = row.alliance ? ` [${row.alliance}]` : '';
  const population = Number(row.population ?? 0).toLocaleString();
  const tribe = getTribe(row.tid).name;

  return `${prefix}${coords} ${distance} - ${village} - ${player}${alliance} - ${population} pop - ${tribe}`;
}
