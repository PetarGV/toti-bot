import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { unixNow, discordTimestamp, parseDeadline } from '../utils/time.js';
import { getResource, parseAmount, formatAmount } from '../utils/resources.js';
import { progressBar } from '../utils/progress.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { registerRenderer } from './calls.js';
import { notifyAuthorOfPledge, notifyAuthorIfMilestone } from './notify.js';
import { getHomeCoordsString } from './profile.js';

// ── Entry: button on resources panel ─────────────────────────────────────
export async function handlePushButton(interaction) {
  const resource = interaction.customId.split(':')[1];
  try { getResource(resource); } catch {
    return interaction.reply({ content: 'Unknown resource.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`push:create:${resource}`)
    .setTitle(`Resource Push — ${getResource(resource).label}`);

  const amount = new TextInputBuilder()
    .setCustomId('amount').setLabel('Amount needed (e.g. 50k or 50000)')
    .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('50k').setMaxLength(20);

  const coords = new TextInputBuilder()
    .setCustomId('coords').setLabel('Destination coords')
    .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(-12|34)').setMaxLength(20);

  try {
    const home = getHomeCoordsString(interaction.user.id);
    if (home) coords.setValue(home);
  } catch { /* no profile */ }

  const deadline = new TextInputBuilder()
    .setCustomId('deadline').setLabel('Deadline (e.g. 14:30 or "in 2h")')
    .setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('in 4h').setMaxLength(20);

  const notes = new TextInputBuilder()
    .setCustomId('notes').setLabel('Notes')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300);

  modal.addComponents(
    new ActionRowBuilder().addComponents(amount),
    new ActionRowBuilder().addComponents(coords),
    new ActionRowBuilder().addComponents(deadline),
    new ActionRowBuilder().addComponents(notes),
  );

  await interaction.showModal(modal);
}

// ── Entry: /push slash command ───────────────────────────────────────────
export async function handlePushCommand(interaction) {
  const resource = interaction.options.getString('resource');
  const coordsStr = interaction.options.getString('coords');
  const amount = interaction.options.getInteger('amount');
  const deadlineStr = interaction.options.getString('deadline');

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: '❌ Invalid coordinates.', ephemeral: true });
  }
  if (!amount || amount <= 0) {
    return interaction.reply({ content: '❌ Amount must be positive.', ephemeral: true });
  }
  let deadline = null;
  if (deadlineStr) {
    deadline = parseDeadline(deadlineStr);
    if (!deadline) {
      return interaction.reply({ content: '❌ Invalid deadline format.', ephemeral: true });
    }
  }

  await createPushCall(interaction, { resource, x: coords.x, y: coords.y, amount, deadline, notes: null });
}

// ── Entry: modal submit `push:create:<resource>` ─────────────────────────
export async function handlePushCreateModal(interaction) {
  const resource = interaction.customId.split(':')[2];
  try { getResource(resource); } catch {
    return interaction.reply({ content: 'Unknown resource.', ephemeral: true });
  }

  const amountStr = interaction.fields.getTextInputValue('amount');
  const coordsStr = interaction.fields.getTextInputValue('coords');
  const deadlineStr = interaction.fields.getTextInputValue('deadline');
  const notes = interaction.fields.getTextInputValue('notes') || null;

  const amount = parseAmount(amountStr);
  if (!amount) {
    return interaction.reply({ content: `❌ Invalid amount: \`${amountStr}\`. Try \`50k\` or \`50000\`.`, ephemeral: true });
  }
  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: `❌ Invalid coordinates: \`${coordsStr}\`.`, ephemeral: true });
  }
  let deadline = null;
  if (deadlineStr) {
    deadline = parseDeadline(deadlineStr);
    if (!deadline) {
      return interaction.reply({ content: `❌ Invalid deadline: \`${deadlineStr}\`.`, ephemeral: true });
    }
  }

  await createPushCall(interaction, { resource, x: coords.x, y: coords.y, amount, deadline, notes });
}

// ── Core: create the call + post the embed ───────────────────────────────
async function createPushCall(interaction, { resource, x, y, amount, deadline, notes }) {
  const payload = JSON.stringify({ resource, amount, notes });

  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(`push:${resource}`, interaction.user.id, x, y, deadline, interaction.channel.id, payload);

  const callId = result.lastInsertRowid;
  inc('callsCreated');

  const embed = buildPushEmbed(callId);
  const components = buildPushComponents(callId, 'open', x, y);

  const msg = await interaction.reply({ embeds: [embed], components, fetchReply: true });

  prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);
}

// ── Pledge: open modal asking how much ───────────────────────────────────
export async function handlePledgeAddButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`pledge:submit:${callId}`)
    .setTitle('Pledge an amount');

  const amount = new TextInputBuilder()
    .setCustomId('amount').setLabel('How much will you send?')
    .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('10k').setMaxLength(20);

  modal.addComponents(new ActionRowBuilder().addComponents(amount));
  await interaction.showModal(modal);
}

// ── Pledge submit ─────────────────────────────────────────────────────────
export async function handlePledgeSubmitModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }

  const amountStr = interaction.fields.getTextInputValue('amount');
  const amount = parseAmount(amountStr);
  if (!amount) {
    return interaction.reply({ content: `❌ Invalid amount: \`${amountStr}\`. Try \`10k\`.`, ephemeral: true });
  }

  const existing = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  if (existing) {
    const newTotal = parseInt(existing.amount, 10) + amount;
    prepare('UPDATE pledges SET amount = ? WHERE call_id = ? AND user_id = ?')
      .run(String(newTotal), callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, String(amount));
  }
  inc('pledgesSubmitted');

  // Auto-close when filled
  const target = computeTarget(call);
  const totalRow = prepare('SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM pledges WHERE call_id = ?').get(callId);
  if (totalRow.total >= target) {
    prepare("UPDATE calls SET status = 'filled' WHERE id = ? AND status = 'open'").run(callId);
  }

  await refreshPushEmbed(interaction.client, callId);
  await interaction.reply({ content: `✅ Pledged ${formatAmount(amount)}.`, ephemeral: true });

  notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, formatAmount(amount)).catch(err => logger.warn('notify pledge:', err.message));
  notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
}

// ── Pledge withdraw ──────────────────────────────────────────────────────
export async function handlePledgeWithdrawButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const existing = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);
  if (!existing) {
    return interaction.reply({ content: 'You have no pledge on this call.', ephemeral: true });
  }
  prepare('DELETE FROM pledges WHERE call_id = ? AND user_id = ?').run(callId, interaction.user.id);
  await refreshPushEmbed(interaction.client, callId);
  await interaction.reply({ content: '✅ Pledge withdrawn.', ephemeral: true });
}

// ── Pledge close (author only) ───────────────────────────────────────────
export async function handlePledgeCloseButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) {
    return interaction.reply({ content: 'Call not found.', ephemeral: true });
  }
  if (call.author_id !== interaction.user.id) {
    return interaction.reply({ content: 'Only the requester can close this call.', ephemeral: true });
  }
  prepare("UPDATE calls SET status = 'closed' WHERE id = ?").run(callId);
  await refreshPushEmbed(interaction.client, callId);
  await interaction.reply({ content: '🔒 Call closed.', ephemeral: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────
function computeTarget(call) {
  const payload = JSON.parse(call.payload || '{}');
  return call.type === 'push:all' ? payload.amount * 4 : payload.amount;
}

export function buildPushEmbed(callId) {
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return new EmbedBuilder().setDescription('Call not found.');

  const payload = JSON.parse(call.payload || '{}');
  const resource = payload.resource;
  const meta = getResource(resource);
  const target = computeTarget(call);

  const totalRow = prepare(
    'SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM pledges WHERE call_id = ?'
  ).get(callId);
  const total = totalRow.total;

  const pledges = prepare(
    'SELECT user_id, amount FROM pledges WHERE call_id = ? ORDER BY created_at DESC LIMIT 10'
  ).all(callId);

  // Status styling
  let statusPrefix = '';
  let color = meta.color;
  if (call.status === 'filled')  { statusPrefix = '✅ Filled — '; color = 0x2ecc71; }
  if (call.status === 'expired') { statusPrefix = '⏰ Expired — '; color = 0x95a5a6; }
  if (call.status === 'closed')  { statusPrefix = '🔒 Closed — '; color = 0x95a5a6; }

  // Optional x_world enrichment
  let destExtra = '';
  try {
    const xw = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(call.x, call.y);
    if (xw?.player) {
      destExtra = ` — ${xw.player}${xw.alliance ? ` [${xw.alliance}]` : ''}`;
    }
  } catch { /* x_world may be empty */ }

  const amountField = call.type === 'push:all'
    ? `${formatAmount(payload.amount)} of each (${formatAmount(target)} total)`
    : formatAmount(payload.amount);

  const senders = pledges.length
    ? pledges.map(p => `<@${p.user_id}> — ${formatAmount(parseInt(p.amount, 10))}`).join('\n')
    : '*No pledges yet*';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${statusPrefix}${meta.emoji} Resource Push — ${meta.label}`)
    .addFields(
      { name: 'Requester',     value: `<@${call.author_id}>`, inline: true },
      { name: 'Destination',   value: `${formatCoords(call.x, call.y)}${destExtra}`, inline: true },
      { name: 'Deadline',      value: call.deadline ? discordTimestamp(call.deadline, 'R') : '*No deadline*', inline: true },
      { name: 'Amount needed', value: amountField, inline: false },
      { name: 'Pledged',       value: `${formatAmount(total)} / ${formatAmount(target)}`, inline: true },
      { name: 'Progress',      value: progressBar(total, target), inline: false },
      { name: 'Senders',       value: senders, inline: false },
    )
    .setFooter({ text: `Call ID: ${callId}` })
    .setTimestamp();

  if (payload.notes) embed.addFields({ name: 'Notes', value: payload.notes });

  return embed;
}

export function buildPushComponents(callId, status, x, y) {
  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Send resources').setEmoji('📦').setURL(mapUrl(x, y)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Map').setEmoji('🗺️').setURL(mapUrl(x, y)),
  );

  if (status !== 'open') return [linkRow];

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pledge:add:${callId}`).setStyle(ButtonStyle.Success).setLabel("I'll send").setEmoji('✅'),
    new ButtonBuilder().setCustomId(`pledge:withdraw:${callId}`).setStyle(ButtonStyle.Secondary).setLabel('Withdraw').setEmoji('❌'),
    new ButtonBuilder().setCustomId(`pledge:close:${callId}`).setStyle(ButtonStyle.Danger).setLabel('Close').setEmoji('🔒'),
  );

  return [actionRow, linkRow];
}

export async function refreshPushEmbed(client, callId) {
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || !call.channel_id || !call.message_id) return;
  try {
    const channel = await client.channels.fetch(call.channel_id);
    const msg = await channel.messages.fetch(call.message_id);
    const embed = buildPushEmbed(callId);
    const components = buildPushComponents(callId, call.status, call.x, call.y);
    await msg.edit({ embeds: [embed], components });
  } catch (err) {
    logger.warn(`Could not refresh push embed for call ${callId}:`, err.message);
  }
}

// ── Register with generic call registry ─────────────────────────────────────
registerRenderer('push', {
  buildEmbed:      (call /*, pledges */) => buildPushEmbed(call.id),
  buildComponents: (call) => buildPushComponents(call.id, call.status, call.x, call.y),
});