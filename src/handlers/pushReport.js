import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { formatCoords } from '../utils/coords.js';
import { formatAmount, getResource } from '../utils/resources.js';
import { mapUrl } from '../utils/travianUrl.js';
import { buildPushEmbed } from './resourcePush.js';

const PAGE_SIZE = 5;

const STATUS_LABEL = {
  open:    'Open',
  filled:  'Filled',
  closed:  'Closed',
  expired: 'Expired',
};

const STATUS_BADGE = {
  filled:  '✅ Filled — ',
  closed:  '🔒 Closed — ',
  expired: '⏰ Expired — ',
};

function computeTarget(call, payload) {
  return call.type === 'push:all' ? payload.amount * 4 : payload.amount;
}

function totalPledged(callId) {
  return prepare('SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM pledges WHERE call_id = ?')
    .get(callId).total;
}

function allSenders(callId) {
  return prepare('SELECT user_id, amount FROM pledges WHERE call_id = ? ORDER BY CAST(amount AS INTEGER) DESC')
    .all(callId);
}

function villageOwner(x, y) {
  const xw = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y);
  if (!xw?.player) return null;
  return xw.alliance ? `${xw.player} [${xw.alliance}]` : xw.player;
}

export function renderPushReportLine(call, guildId) {
  const payload = JSON.parse(call.payload || '{}');
  const resource = getResource(payload.resource);
  const target = computeTarget(call, payload);
  const total = totalPledged(call.id);
  const senders = allSenders(call.id);
  const owner = villageOwner(call.x, call.y);

  const badge = STATUS_BADGE[call.status] ?? '';
  const jump = call.message_id && call.channel_id
    ? ` — [Jump](https://discord.com/channels/${guildId}/${call.channel_id}/${call.message_id})`
    : '';
  const destination = `${formatCoords(call.x, call.y)}${owner ? ` — ${owner}` : ''}`;
  const senderLines = senders.length
    ? senders.map(s => `  • <@${s.user_id}> ${formatAmount(parseInt(s.amount, 10))}`).join('\n')
    : '  *no senders*';

  return [
    `${resource.emoji} **${resource.label}** → ${destination} — ${badge}${jump}`,
    `  ${formatAmount(total)}/${formatAmount(target)} (${senders.length} sender${senders.length === 1 ? '' : 's'})`,
    senderLines,
  ].join('\n');
}

export function fetchPushReportPage({ offset = 0 } = {}) {
  const total = prepare("SELECT COUNT(*) as c FROM calls WHERE type LIKE 'push:%'").get().c;
  const rows = prepare(
    "SELECT * FROM calls WHERE type LIKE 'push:%' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
  ).all(PAGE_SIZE, offset);

  return { rows, total };
}

function buildSelectOptionLabel(call) {
  const payload = JSON.parse(call.payload || '{}');
  const resource = getResource(payload.resource);
  return `${resource.emoji} ${resource.label} → ${formatCoords(call.x, call.y)}`.slice(0, 100);
}

function buildSelectOptionDescription(call) {
  const payload = JSON.parse(call.payload || '{}');
  const target = computeTarget(call, payload);
  const total = totalPledged(call.id);
  const status = STATUS_LABEL[call.status] ?? call.status;
  return `${status} — ${formatAmount(total)}/${formatAmount(target)}`.slice(0, 100);
}

function buildSelectRow(rows, offset) {
  const options = rows.map(call =>
    new StringSelectMenuOptionBuilder()
      .setLabel(buildSelectOptionLabel(call))
      .setDescription(buildSelectOptionDescription(call))
      .setValue(String(call.id)),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`admin:push-report:select:${offset}`)
    .setPlaceholder('View a specific push…')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

export function buildPushReportPayload({ offset = 0, guildId = null } = {}) {
  const { rows, total } = fetchPushReportPage({ offset });

  const pageNum = Math.floor(offset / PAGE_SIZE) + 1;
  const pageMax = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const description = rows.length
    ? rows.map(c => renderPushReportLine(c, guildId)).join('\n\n')
    : '*No resource pushes found*';

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`📦 Resource Push History (page ${pageNum}/${pageMax})`)
    .setDescription(description)
    .setFooter({ text: `${total} push${total === 1 ? '' : 'es'} total` })
    .setTimestamp();

  const prevDisabled = offset === 0;
  const nextDisabled = offset + PAGE_SIZE >= total;

  const pageRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin:push-report:page:${Math.max(0, offset - PAGE_SIZE)}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(`admin:push-report:page:${offset + PAGE_SIZE}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Next')
      .setEmoji('➡️')
      .setDisabled(nextDisabled),
  );

  const components = rows.length ? [buildSelectRow(rows, offset), pageRow] : [pageRow];

  return { embeds: [embed], components };
}

export function buildPushReportDetailPayload(callId, offset) {
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) {
    return { embeds: [new EmbedBuilder().setDescription('Push not found — it may have been deleted.')], components: [] };
  }

  const embed = buildPushEmbed(callId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Map').setEmoji('🗺️').setURL(mapUrl(call.x, call.y)),
    new ButtonBuilder()
      .setCustomId(`admin:push-report:back:${offset}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Back to list')
      .setEmoji('◀️'),
  );

  return { embeds: [embed], components: [row] };
}

export async function handlePushReportCommand(interaction) {
  const payload = buildPushReportPayload({ offset: 0, guildId: interaction.guildId });
  return interaction.reply({ ...payload, ephemeral: true });
}

export async function handlePushReportPage(interaction) {
  // admin:push-report:page:<offset>
  const offset = parseInt(interaction.customId.split(':')[3], 10) || 0;
  const payload = buildPushReportPayload({ offset, guildId: interaction.guildId });
  return interaction.update(payload);
}

export async function handlePushReportSelect(interaction) {
  // admin:push-report:select:<offset>
  const offset = parseInt(interaction.customId.split(':')[3], 10) || 0;
  const callId = parseInt(interaction.values[0], 10);
  const payload = buildPushReportDetailPayload(callId, offset);
  return interaction.update(payload);
}

export async function handlePushReportBack(interaction) {
  // admin:push-report:back:<offset>
  const offset = parseInt(interaction.customId.split(':')[3], 10) || 0;
  const payload = buildPushReportPayload({ offset, guildId: interaction.guildId });
  return interaction.update(payload);
}
