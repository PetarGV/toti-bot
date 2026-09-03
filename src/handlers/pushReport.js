import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prepare } from '../db/client.js';
import { formatCoords } from '../utils/coords.js';
import { formatAmount, getResource } from '../utils/resources.js';

const PAGE_SIZE = 10;

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
  const senderList = senders.length
    ? senders.map(s => `<@${s.user_id}> ${formatAmount(parseInt(s.amount, 10))}`).join(', ')
    : '*no senders*';

  return [
    `${resource.emoji} **${resource.label}** → ${destination} — ${badge}${jump}`,
    `  ${formatAmount(total)}/${formatAmount(target)} (${senders.length} sender${senders.length === 1 ? '' : 's'})`,
    `  Senders: ${senderList}`,
  ].join('\n');
}

export function fetchPushReportPage({ offset = 0 } = {}) {
  const total = prepare("SELECT COUNT(*) as c FROM calls WHERE type LIKE 'push:%'").get().c;
  const rows = prepare(
    "SELECT * FROM calls WHERE type LIKE 'push:%' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
  ).all(PAGE_SIZE, offset);

  return { rows, total };
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

  const row = new ActionRowBuilder().addComponents(
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

  return { embeds: [embed], components: [row] };
}

export async function handlePushReportCommand(interaction) {
  const payload = buildPushReportPayload({ offset: 0, guildId: interaction.guildId });
  return interaction.reply({ ...payload, ephemeral: true });
}

export async function handlePushReportPage(interaction) {
  // admin:push-report:page:<offset>
  const parts = interaction.customId.split(':');
  const offset = parseInt(parts[3], 10) || 0;
  const payload = buildPushReportPayload({ offset, guildId: interaction.guildId });
  return interaction.update(payload);
}
