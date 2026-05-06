import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { registerRenderer } from './calls.js';
import { notifyAuthorOfPledge, notifyAuthorIfMilestone } from './notify.js';
import { getHomeCoordsString } from './profile.js';

// ── Button entry: call:scout ──────────────────────────────────────────────────
export async function handleScoutButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('scout:create')
    .setTitle('Scout Request');

  const coordsInput = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Coordinates to scout')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('(-12|34)')
    .setMaxLength(20);

  try {
    const home = getHomeCoordsString(interaction.user.id);
    if (home) coordsInput.setValue(home);
  } catch { /* no profile */ }

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(notesInput),
  );

  await interaction.showModal(modal);
}

// ── Core: insert scout call + post embed ─────────────────────────────────────
async function createScoutCall(interaction, { x, y, notes }) {
  const payload = JSON.stringify({ notes: notes || null });

  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES ('scout', ?, ?, ?, NULL, ?, 'open', ?)
  `).run(interaction.user.id, x, y, interaction.channel.id, payload);

  const callId = result.lastInsertRowid;
  inc('callsCreated');

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const embed = buildScoutEmbed(call, []);
  const components = buildScoutComponents(call);

  const msg = await interaction.reply({
    content: '',
    embeds: [embed],
    components,
    fetchReply: true,
  });

  prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);
}

// ── Modal submit: scout:create ────────────────────────────────────────────────
export async function handleScoutCreateModal(interaction) {
  const coordsStr = interaction.fields.getTextInputValue('coords');
  const notes     = interaction.fields.getTextInputValue('notes') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: `❌ Invalid coordinates: \`${coordsStr}\`.`, ephemeral: true });
  }

  await createScoutCall(interaction, { x: coords.x, y: coords.y, notes });
}

// ── Slash command handler ─────────────────────────────────────────────────────
export async function handleScoutCommand(interaction) {
  const coordsStr = interaction.options.getString('coords');
  const notes     = interaction.options.getString('notes') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: '❌ Invalid coordinates.', ephemeral: true });
  }

  await createScoutCall(interaction, { x: coords.x, y: coords.y, notes });
}

// ── Response button handlers ──────────────────────────────────────────────────

// scout:join:<callId> — toggles "On it" pledge
export async function handleScoutJoinButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }

  const existing = prepare('SELECT id, amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  let msg;
  if (existing && existing.amount === 'On it') {
    // Toggle off — remove commitment (but not if they have a report)
    prepare('DELETE FROM pledges WHERE call_id = ? AND user_id = ?').run(callId, interaction.user.id);
    msg = '✅ Removed your "On it" commitment.';
  } else if (!existing) {
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, 'On it');
    inc('pledgesSubmitted');
    msg = '✅ Marked as "On it".';
  } else {
    // They have a report — don't overwrite
    return interaction.reply({ content: 'You already submitted a report. Use "Submit Report" to update it.', ephemeral: true });
  }

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: msg, ephemeral: true });

  if (!existing) {
    notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, 'On it').catch(err => logger.warn('notify pledge:', err.message));
    notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
  }
}

// scout:report:<callId> — opens modal
export async function handleScoutReportButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`scout:report_submit:${callId}`)
    .setTitle('Submit Scout Report');

  const reportInput = new TextInputBuilder()
    .setCustomId('report')
    .setLabel('Scout report')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(reportInput));
  await interaction.showModal(modal);
}

// scout:close:<callId>
export async function handleScoutCloseButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return interaction.reply({ content: 'Call not found.', ephemeral: true });

  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (call.author_id !== interaction.user.id && !isAdmin) {
    return interaction.reply({ content: '❌ Only the requester or an admin can close this call.', ephemeral: true });
  }

  prepare("UPDATE calls SET status = 'closed' WHERE id = ?").run(callId);

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: '🔒 Scout request closed.', ephemeral: true });
}

// ── Modal: scout:report_submit:<callId> ──────────────────────────────────────
export async function handleScoutReportModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }

  const report = interaction.fields.getTextInputValue('report').trim();
  if (!report) {
    return interaction.reply({ content: '❌ Report cannot be empty.', ephemeral: true });
  }

  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  if (existing) {
    prepare('UPDATE pledges SET amount = ? WHERE call_id = ? AND user_id = ?')
      .run(report, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, report);
    inc('pledgesSubmitted');
  }

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: '✅ Scout report submitted.', ephemeral: true });

  notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, 'report').catch(err => logger.warn('notify pledge:', err.message));
  notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
}

// ── Embed builder ─────────────────────────────────────────────────────────────
export function buildScoutEmbed(call, pledges) {
  const payload = JSON.parse(call.payload || '{}');

  let statusPrefix = '';
  let color = 0x3498db;
  if (call.status === 'expired') { statusPrefix = '⏰ Expired — '; color = 0x95a5a6; }
  if (call.status === 'closed')  { statusPrefix = '🔒 Closed — ';  color = 0x95a5a6; }

  // x_world enrichment
  let coordsExtra = '';
  try {
    const xw = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(call.x, call.y);
    if (xw?.player) {
      coordsExtra = ` — ${xw.player}${xw.alliance ? ` [${xw.alliance}]` : ''}`;
    }
  } catch { /* x_world may not exist */ }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${statusPrefix}👀 Scout Request`)
    .addFields(
      { name: 'Requester', value: `<@${call.author_id}>`, inline: true },
      { name: 'Coords',    value: `${formatCoords(call.x, call.y)}${coordsExtra}`, inline: true },
    );

  if (payload.notes) embed.addFields({ name: 'Notes', value: payload.notes, inline: false });

  // Separate pledges into "On it" and "report submitted"
  const onItList = pledges.filter(p => p.amount === 'On it');
  const reports  = pledges.filter(p => p.amount !== 'On it');

  if (onItList.length) {
    embed.addFields({
      name: `On it (${onItList.length})`,
      value: onItList.map(p => `<@${p.user_id}>`).join(', '),
      inline: false,
    });
  } else {
    embed.addFields({ name: 'On it', value: '*Nobody yet*', inline: false });
  }

  if (reports.length) {
    const reportBlocks = reports.map(p => {
      const truncated = p.amount.length > 500 ? p.amount.slice(0, 497) + '...' : p.amount;
      return `**<@${p.user_id}>:**\n${truncated}`;
    }).join('\n\n');
    embed.addFields({ name: `Reports (${reports.length})`, value: reportBlocks, inline: false });
  }

  embed.setFooter({ text: `Call ID: ${call.id}` }).setTimestamp();

  return embed;
}

// ── Components builder ────────────────────────────────────────────────────────
export function buildScoutComponents(call) {
  const id = call.id;

  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Map').setEmoji('🗺️').setURL(mapUrl(call.x, call.y)),
  );

  if (call.status !== 'open') return [linkRow];

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`scout:join:${id}`).setStyle(ButtonStyle.Primary).setLabel('On it').setEmoji('👀'),
    new ButtonBuilder().setCustomId(`scout:report:${id}`).setStyle(ButtonStyle.Success).setLabel('Submit Report').setEmoji('📝'),
    new ButtonBuilder().setCustomId(`scout:close:${id}`).setStyle(ButtonStyle.Danger).setLabel('Close').setEmoji('🔒'),
  );

  return [actionRow, linkRow];
}

// ── Register renderer ─────────────────────────────────────────────────────────
registerRenderer('scout', {
  buildEmbed:      (call, pledges) => buildScoutEmbed(call, pledges),
  buildComponents: (call)          => buildScoutComponents(call),
});