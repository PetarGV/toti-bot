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
import { ensureScoutInfrastructure, createScoutTempChannel } from '../utils/scoutChannels.js';
import {
  decodeScoutCommitmentAmount,
  decodeScoutReportText,
  encodeScoutCommitmentAmount,
  encodeScoutReportText,
  generateScoutCode,
  isScoutCommitment,
  parseScoutCommitmentAmount,
} from '../utils/scoutReports.js';
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

  const minScoutsInput = new TextInputBuilder()
    .setCustomId('min_scouts')
    .setLabel('Minimum scouts needed (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(50);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(notesInput),
    new ActionRowBuilder().addComponents(minScoutsInput),
  );

  await interaction.showModal(modal);
}

// ── Core: insert scout call + post embed ─────────────────────────────────────
function getOptionalTextInputValue(fields, customId) {
  if (!fields?.getTextInputValue) return null;
  try {
    return fields.getTextInputValue(customId) || null;
  } catch {
    return null;
  }
}

async function createScoutCall(interaction, { x, y, notes, minScouts }) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  const scoutCode = generateScoutCode();
  const guildId = interaction.guildId || interaction.guild?.id || null;
  const target = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y) || null;
  const targetPlayer = target?.player || null;
  const targetAlliance = target?.alliance || null;
  const { category } = await ensureScoutInfrastructure(interaction.guild);
  const tempChannel = await createScoutTempChannel(interaction.guild, {
    category,
    code: scoutCode,
    x,
    y,
    player: targetPlayer,
    topic: `Scout ${scoutCode} for ${formatCoords(x, y)}`,
  });

  const payload = JSON.stringify({
    notes: notes || null,
    minScouts: minScouts || null,
    targetPlayer,
    targetAlliance,
    tempChannelId: tempChannel.id,
    scoutCode,
    guildId,
  });
  let callId = null;
  let published = false;

  try {
    const result = prepare(`
      INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
      VALUES ('scout', ?, ?, ?, NULL, ?, 'open', ?)
    `).run(interaction.user.id, x, y, tempChannel.id, payload);

    callId = result.lastInsertRowid;
    inc('callsCreated');

    prepare(`
      INSERT INTO scout_reports (call_id, scout_code, temp_channel_id)
      VALUES (?, ?, ?)
    `).run(callId, scoutCode, tempChannel.id);

    const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    const embed = buildScoutEmbed(call, []);
    const components = buildScoutComponents(call);

    const msg = await tempChannel.send({
      embeds: [embed],
      components,
    });

    prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);
    published = true;
  } catch (err) {
    if (!published && callId != null) {
      try {
        prepare('DELETE FROM scout_reports WHERE call_id = ?').run(callId);
      } catch (cleanupErr) {
        logger.warn('cleanup scout_reports failed:', cleanupErr.message);
      }
      try {
        prepare('DELETE FROM calls WHERE id = ?').run(callId);
      } catch (cleanupErr) {
        logger.warn('cleanup calls failed:', cleanupErr.message);
      }
    }

    if (!published && typeof tempChannel?.delete === 'function') {
      try {
        await tempChannel.delete();
      } catch (cleanupErr) {
        logger.warn('cleanup temp channel failed:', cleanupErr.message);
      }
    }

    throw err;
  }

  await interaction.editReply({ content: `Scout request created: <#${tempChannel.id}>` });
}

// ── Modal submit: scout:create ────────────────────────────────────────────────
export async function handleScoutCreateModal(interaction) {
  const coordsStr = interaction.fields.getTextInputValue('coords');
  const notes     = interaction.fields.getTextInputValue('notes') || null;
  const minScouts = getOptionalTextInputValue(interaction.fields, 'min_scouts');

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: `❌ Invalid coordinates: \`${coordsStr}\`.`, ephemeral: true });
  }

  await createScoutCall(interaction, { x: coords.x, y: coords.y, notes, minScouts });
}

// ── Slash command handler ─────────────────────────────────────────────────────
export async function handleScoutCommand(interaction) {
  const coordsStr = interaction.options.getString('coords');
  const notes     = interaction.options.getString('notes') || null;
  const minScouts = interaction.options.getString('min-scouts') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: '❌ Invalid coordinates.', ephemeral: true });
  }

  await createScoutCall(interaction, { x: coords.x, y: coords.y, notes, minScouts });
}

// ── Response button handlers ──────────────────────────────────────────────────

// scout:join:<callId> opens commitment amount modal
export async function handleScoutJoinButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }

  const existing = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  const modal = new ModalBuilder()
    .setCustomId(`scout:join_submit:${callId}`)
    .setTitle('Scout Commitment');

  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Scouts you can send')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('75 scouts')
    .setMaxLength(100);

  const existingCommitment = decodeScoutCommitmentAmount(existing?.amount);
  if (existingCommitment) {
    amountInput.setValue(existingCommitment);
  }

  modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
  return interaction.showModal(modal);
}

export async function handleScoutJoinModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }

  const amountText = interaction.fields.getTextInputValue('amount').trim();
  const amount = amountText || 'On it';
  if (amountText && !parseScoutCommitmentAmount(amountText)) {
    return interaction.reply({ content: 'Scout commitment must start with a positive number, or leave it blank for On it.', ephemeral: true });
  }
  const storedAmount = amountText ? encodeScoutCommitmentAmount(amountText) : 'On it';
  const existing = prepare('SELECT id, amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);
  if (existing && !isScoutCommitment(existing.amount)) {
    return interaction.reply({ content: 'You already submitted a report. Use "Submit Report" to update it.', ephemeral: true });
  }

  if (existing) {
    prepare('UPDATE pledges SET amount = ? WHERE call_id = ? AND user_id = ?')
      .run(storedAmount, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, storedAmount);
    inc('pledgesSubmitted');
  }

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: `Scout commitment recorded: ${amount}`, ephemeral: true });

  notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, amount).catch(err => logger.warn('notify pledge:', err.message));
  notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
}

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

  const storedReport = encodeScoutReportText(report);
  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  if (existing) {
    prepare('UPDATE pledges SET amount = ? WHERE call_id = ? AND user_id = ?')
      .run(storedReport, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, storedReport);
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
    const player = payload.targetPlayer || null;
    const alliance = payload.targetAlliance || null;
    if (player) {
      coordsExtra = ` — ${player}${alliance ? ` [${alliance}]` : ''}`;
    } else {
      const xw = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(call.x, call.y);
      if (xw?.player) {
        coordsExtra = ` — ${xw.player}${xw.alliance ? ` [${xw.alliance}]` : ''}`;
      }
    }
  } catch { /* x_world may not exist */ }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${statusPrefix}👀 Scout Request`)
    .addFields(
      { name: 'Requester', value: `<@${call.author_id}>`, inline: true },
      { name: 'Coords',    value: `[${formatCoords(call.x, call.y)}](${mapUrl(call.x, call.y)})${coordsExtra}`, inline: true },
    );

  if (payload.notes) embed.addFields({ name: 'Notes', value: payload.notes, inline: false });

  const minimumScouts = parseScoutCommitmentAmount(payload.minScouts);
  if (minimumScouts) {
    const committedScouts = pledges.reduce((total, pledge) => (
      total + (parseScoutCommitmentAmount(decodeScoutCommitmentAmount(pledge.amount)) ?? 0)
    ), 0);
    embed.addFields(
      { name: 'Minimum scouts', value: String(minimumScouts), inline: true },
      { name: 'Committed scouts', value: String(committedScouts), inline: true },
      { name: 'Remaining scouts', value: String(Math.max(minimumScouts - committedScouts, 0)), inline: true },
    );
  }

  // Separate status commitments from free-text scout reports.
  const onItList = pledges.filter(p => isScoutCommitment(p.amount));
  const reports  = pledges
    .map(p => ({ ...p, reportText: decodeScoutReportText(p.amount) }))
    .filter(p => p.reportText !== null);

  if (onItList.length) {
    embed.addFields({
      name: `On it (${onItList.length})`,
      value: onItList.map(p => {
        const commitment = decodeScoutCommitmentAmount(p.amount);
        return commitment ? `<@${p.user_id}> (${commitment})` : `<@${p.user_id}>`;
      }).join(', '),
      inline: false,
    });
  } else {
    embed.addFields({ name: 'On it', value: '*Nobody yet*', inline: false });
  }

  if (reports.length) {
    const reportBlocks = reports.map(p => {
      const truncated = p.reportText.length > 500 ? p.reportText.slice(0, 497) + '...' : p.reportText;
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
