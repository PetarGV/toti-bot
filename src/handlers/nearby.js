import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { getTribe } from '../utils/tribes.js';
import { getPrimaryLinkForUser } from './userIgnLinks.js';
import {
  findNearbyVillages,
  getLastMapFetchedAt,
  getMapDataCount,
  normalizeNearbyOptions,
} from '../utils/mapSearch.js';

const MODAL_ID = 'nearby:lookup';
const MAX_EMBED_DESCRIPTION = 3900;
const TABLE_COLUMNS = [
  { key: 'coords', label: 'Coord', width: 9 },
  { key: 'distance', label: 'Dist', width: 5, align: 'right' },
  { key: 'tag', label: 'Tag', width: 6 },
  { key: 'player', label: 'Player', width: 14 },
  { key: 'alliance', label: 'Ally', width: 6 },
  { key: 'villagePopulation', label: 'VPop', width: 6, align: 'right' },
  { key: 'playerPopulation', label: 'PPop', width: 7, align: 'right' },
  { key: 'tribe', label: 'Tribe', width: 8 },
];

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
    .setPlaceholder('Default: 10, max: 40')
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
  const primary = getPrimaryLinkForUser(interaction.user?.id);
  const result = findNearbyVillages(coords, {
    ...options,
    comparisonPlayer: primary?.ign ?? null,
  });

  if (!result.centerVillage && result.villages.length === 0) {
    return interaction.reply({
      content: `No villages found within ${result.radius} fields of ${formatCoords(coords.x, coords.y)}.`,
      ephemeral: true,
    });
  }

  const fetchedAt = getLastMapFetchedAt();
  const embeds = buildNearbyEmbeds(coords, result, fetchedAt);

  // Discord caps the total content of all embeds in a SINGLE message at
  // 6000 chars. With high limits + the table format we can produce 2-3
  // embeds whose sum exceeds that. Each followUp message gets its own
  // 6000-char budget, so we split additional embeds into separate sends.
  const [first, ...rest] = embeds;
  await interaction.reply({ embeds: [first], ephemeral: true });
  for (const embed of rest) {
    await interaction.followUp({ embeds: [embed], ephemeral: true });
  }
}

export function buildNearbyEmbed(center, result, fetchedAt) {
  return buildNearbyEmbeds(center, result, fetchedAt)[0];
}

export function buildNearbyEmbeds(center, result, fetchedAt) {
  const shown = (result.centerVillage ? 1 : 0) + result.villages.length;
  const tableChunks = buildTableChunks(buildTableRows(result));

  return tableChunks.map((description, index) => {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(index === 0
        ? `Nearby villages around ${formatCoords(center.x, center.y)}`
        : `Nearby villages around ${formatCoords(center.x, center.y)} (continued)`)
      .setDescription(description);

    if (index === 0) {
      embed.addFields(
        { name: 'Search center', value: formatCoords(center.x, center.y), inline: true },
        { name: 'Radius', value: `${result.radius} fields`, inline: true },
        { name: 'Shown', value: String(shown), inline: true },
        { name: 'Found in radius', value: String(result.totalInRadius), inline: true },
      );

      if (result.comparisonPlayer && result.comparisonPopulation) {
        embed.addFields({
          name: 'Population baseline',
          value: `${result.comparisonPlayer}: ${formatPopulation(result.comparisonPopulation)} total pop`,
          inline: true,
        });
      } else {
        embed.addFields({
          name: 'Population labels',
          value: 'Link your IGN to enable population comparison.',
          inline: false,
        });
      }
    }

    if (fetchedAt) {
      embed.setFooter({ text: 'Map data updated' }).setTimestamp(new Date(fetchedAt * 1000));
    }

    return embed;
  });
}

function buildTableRows(result) {
  const rows = [];
  if (result.centerVillage) rows.push(formatTableRow(result.centerVillage));
  rows.push(...result.villages.map((row) => formatTableRow(row)));
  return rows;
}

// Discord renders ANSI escape codes inside ```ansi``` code blocks.
// 32 = green, 31 = red. 0 resets back to default. Everything else stays
// in the channel's default text colour (the "neutral" case).
function colorizeRow(line, tag) {
  if (tag === 'FARM')   return `[32m${line}[0m`;
  if (tag === 'THREAT') return `[31m${line}[0m`;
  return line;
}

function buildTableChunks(rows) {
  const header = formatTableHeader();
  const separator = TABLE_COLUMNS.map((column) => '-'.repeat(column.width)).join(' ');
  const chunks = [];
  // Each chunk: header, separator, then for each row: row + trailing separator.
  let current = [header, separator];

  for (const row of rows) {
    const next = [...current, row, separator];
    if (wrapCodeBlock(next).length > MAX_EMBED_DESCRIPTION && current.length > 2) {
      chunks.push(wrapCodeBlock(current));
      current = [header, separator, row, separator];
    } else {
      current = next;
    }
  }

  chunks.push(wrapCodeBlock(current));
  return chunks;
}

function wrapCodeBlock(lines) {
  return ['```ansi', ...lines, '```'].join('\n');
}

function formatTableHeader() {
  return TABLE_COLUMNS.map((column) => formatCell(column.label, column)).join(' ');
}

function formatTableRow(row) {
  const values = {
    coords: formatCoords(row.x, row.y),
    distance: Number(row.distance ?? 0).toFixed(1),
    tag: row.populationTag || '',
    player: row.player || 'Unoccupied',
    alliance: row.alliance || '',
    villagePopulation: formatPopulation(row.population),
    playerPopulation: row.playerPopulation == null ? '' : formatPopulation(row.playerPopulation),
    tribe: getTribe(row.tid).name,
  };

  const line = TABLE_COLUMNS.map((column) => formatCell(values[column.key], column)).join(' ');
  return colorizeRow(line, row.populationTag);
}

function formatCell(value, column) {
  const text = truncateCell(String(value ?? '').replace(/\s+/g, ' ').trim(), column.width);
  return column.align === 'right' ? text.padStart(column.width) : text.padEnd(column.width);
}

function truncateCell(value, width) {
  return value.length > width ? value.slice(0, width) : value;
}

function formatPopulation(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(Math.trunc(n)) : '';
}
