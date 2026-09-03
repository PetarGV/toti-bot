import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prepare } from '../db/client.js';
import { formatCoords } from '../utils/coords.js';
import { formatAmount, getResource } from '../utils/resources.js';

const PAGE_SIZE = 10;
const TOP_SENDERS_LIMIT = 3;
const NO_FILTER = '_';

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

function topSenders(callId) {
  return prepare('SELECT user_id, amount FROM pledges WHERE call_id = ? ORDER BY CAST(amount AS INTEGER) DESC LIMIT ?')
    .all(callId, TOP_SENDERS_LIMIT);
}

function senderCount(callId) {
  return prepare('SELECT COUNT(*) as c FROM pledges WHERE call_id = ?').get(callId).c;
}

export function renderPushReportLine(call, guildId) {
  const payload = JSON.parse(call.payload || '{}');
  const resource = getResource(payload.resource);
  const target = computeTarget(call, payload);
  const total = totalPledged(call.id);
  const count = senderCount(call.id);
  const senders = topSenders(call.id);

  const badge = STATUS_BADGE[call.status] ?? '';
  const jump = call.message_id && call.channel_id
    ? ` — [Jump](https://discord.com/channels/${guildId}/${call.channel_id}/${call.message_id})`
    : '';
  const senderList = senders.length
    ? senders.map(s => `<@${s.user_id}> ${formatAmount(parseInt(s.amount, 10))}`).join(', ')
    : null;

  return [
    `${resource.emoji} **${resource.label}** → ${formatCoords(call.x, call.y)} — ${badge}${jump}`,
    `  Requester: <@${call.author_id}> — ${formatAmount(total)}/${formatAmount(target)} (${count} sender${count === 1 ? '' : 's'})`,
    senderList ? `  Top: ${senderList}` : null,
  ].filter(Boolean).join('\n');
}

export function fetchPushReportPage({ offset = 0, requesterId = null } = {}) {
  const where = requesterId ? "type LIKE 'push:%' AND author_id = ?" : "type LIKE 'push:%'";
  const params = requesterId ? [requesterId] : [];

  const total = prepare(`SELECT COUNT(*) as c FROM calls WHERE ${where}`).get(...params).c;
  const rows = prepare(`SELECT * FROM calls WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);

  return { rows, total };
}

export function buildPushReportPayload({ offset = 0, requesterId = null, guildId = null } = {}) {
  const { rows, total } = fetchPushReportPage({ offset, requesterId });

  const pageNum = Math.floor(offset / PAGE_SIZE) + 1;
  const pageMax = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const description = rows.length
    ? rows.map(c => renderPushReportLine(c, guildId)).join('\n\n')
    : '*No resource pushes found*';

  const title = requesterId
    ? `📦 Resource Push History — <@${requesterId}> (page ${pageNum}/${pageMax})`
    : `📦 Resource Push History (page ${pageNum}/${pageMax})`;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${total} push${total === 1 ? '' : 'es'} total` })
    .setTimestamp();

  const prevDisabled = offset === 0;
  const nextDisabled = offset + PAGE_SIZE >= total;
  const filterTag = requesterId ?? NO_FILTER;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin:push-report:page:${Math.max(0, offset - PAGE_SIZE)}:${filterTag}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(`admin:push-report:page:${offset + PAGE_SIZE}:${filterTag}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Next')
      .setEmoji('➡️')
      .setDisabled(nextDisabled),
  );

  return { embeds: [embed], components: [row] };
}

export async function handlePushReportCommand(interaction) {
  const requester = interaction.options.getUser('requester');
  const payload = buildPushReportPayload({
    offset: 0,
    requesterId: requester?.id ?? null,
    guildId: interaction.guildId,
  });
  return interaction.reply({ ...payload, ephemeral: true });
}

export async function handlePushReportPage(interaction) {
  // admin:push-report:page:<offset>:<requesterId | _>
  const parts = interaction.customId.split(':');
  const offset = parseInt(parts[3], 10) || 0;
  const requesterId = parts[4] === NO_FILTER ? null : parts[4];
  const payload = buildPushReportPayload({ offset, requesterId, guildId: interaction.guildId });
  return interaction.update(payload);
}
