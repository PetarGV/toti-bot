// src/handlers/defCalls.js
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl, rallyUrl } from '../utils/travianUrl.js';
import { discordTimestamp, formatDeadline, parseDeadline } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { getDefRoleMention } from '../utils/role.js';
import { avgWaveGapSec, defValue } from '../utils/defMath.js';
import { isLeadershipOrCoord } from '../utils/tier.js';
import { registerRenderer, refreshCall } from './calls.js';
import { COMBAT_CONFIG } from './combat.js';
import { rebuildDashboard } from './intel.js';

function getDefCallsChannelId() {
  const row = prepare('SELECT channel_id FROM panels WHERE type = ?').get('def-calls');
  return row?.channel_id ?? null;
}

function getLeadershipChannelId() {
  const row = prepare('SELECT channel_id FROM panels WHERE type = ?').get('leadership');
  return row?.channel_id ?? null;
}

function progressBar(pct) {
  const filled = Math.max(0, Math.min(8, Math.round(pct * 8)));
  return '█'.repeat(filled) + '░'.repeat(8 - filled);
}

function xworldExtra(x, y) {
  try {
    const r = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y);
    if (!r?.player) return '';
    return ` — ${r.player}${r.alliance ? ` [${r.alliance}]` : ''}`;
  } catch { return ''; }
}

export function buildDefCallEmbed(call, pledges) {
  const config = COMBAT_CONFIG[call.type];
  const payload = JSON.parse(call.payload || '{}');
  const needed = payload.troops_needed | 0;
  const totalInf = pledges.reduce((s, p) => s + (p.inf || 0), 0);
  const totalCav = pledges.reduce((s, p) => s + (p.cav || 0), 0);
  const totalDef = defValue(totalInf, totalCav);
  const pct = needed > 0 ? Math.min(1, totalDef / needed) : 0;

  let statusPrefix = '';
  let color = config.color;
  if (call.status === 'filled')  { statusPrefix = '✅ FILLED — ';  color = 0x2ecc71; }
  if (call.status === 'expired') { statusPrefix = '⏰ Expired — '; color = 0x95a5a6; }
  if (call.status === 'closed')  { statusPrefix = '🔒 Closed — ';  color = 0x95a5a6; }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${statusPrefix}${config.emoji} ${config.label.toUpperCase()} — needs ${needed} def`)
    .addFields(
      { name: 'Author',   value: `<@${call.author_id}>`, inline: true },
      { name: 'Defender', value: `[${formatCoords(call.x, call.y)}](${mapUrl(call.x, call.y)})${xworldExtra(call.x, call.y)}`, inline: true },
    );

  if (!config.noDeadline) {
    embed.addFields({ name: 'Impact', value: call.deadline ? `${discordTimestamp(call.deadline, 'D')} ${discordTimestamp(call.deadline, 'T')} (${discordTimestamp(call.deadline, 'R')})` : '*Unknown*', inline: true });
  }

  embed.addFields({ name: 'Needed', value: `${needed} def`, inline: true });
  if (payload.notes) embed.addFields({ name: 'Notes', value: payload.notes, inline: false });

  // Responder lines
  const MAX_SHOWN = 15;
  const sorted = [...pledges].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  const shown = sorted.slice(0, MAX_SHOWN);
  const lines = shown.map(p => `<@${p.user_id}> — ${p.inf | 0} inf / ${p.cav | 0} cav = ${defValue(p.inf, p.cav)} def`);
  if (sorted.length > MAX_SHOWN) lines.push(`_... and ${sorted.length - MAX_SHOWN} more_`);

  embed.addFields({
    name: `Responders (${pledges.length})`,
    value: lines.length ? lines.join('\n') : '*No responders yet*',
    inline: false,
  });

  embed.addFields({
    name: 'Total',
    value: `${totalInf} inf / ${totalCav} cav = ${totalDef} def / ${needed} needed (${Math.round(pct * 100)}%)  ${progressBar(pct)}`,
    inline: false,
  });

  if (payload.source_report_id) {
    embed.addFields({ name: 'Source', value: `Report #${payload.source_report_id}`, inline: false });
  }

  embed.setFooter({ text: `Call ID: ${call.id}` }).setTimestamp();
  return embed;
}

export function buildDefCallComponents(call) {
  const id = call.id;
  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Map').setEmoji('🗺️').setURL(mapUrl(call.x, call.y)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Send Troops').setEmoji('🚀').setURL(rallyUrl(call.x, call.y)),
  );
  if (call.status !== 'open') return [linkRow];

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`combat:send_def:${id}`).setStyle(ButtonStyle.Success).setLabel('Sending Def').setEmoji('🛟'),
    new ButtonBuilder().setCustomId(`combat:withdraw:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Withdraw').setEmoji('❌'),
    new ButtonBuilder().setCustomId(`combat:update:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Update').setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`combat:pick:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Pick time').setEmoji('📅'),
    new ButtonBuilder().setCustomId(`combat:close:${id}`).setStyle(ButtonStyle.Danger).setLabel('Close').setEmoji('🔒'),
  );

  // Perma has no time picker (no deadline at all)
  if (COMBAT_CONFIG[call.type]?.noDeadline) {
    actionRow.components = actionRow.components.filter(c => c.data.custom_id !== `combat:pick:${id}`);
  }
  return [actionRow, linkRow];
}

// Register so refreshCall can re-render def_active / def_perma messages.
for (const type of ['def_active', 'def_perma']) {
  registerRenderer(type, {
    buildEmbed:      (call, pledges) => buildDefCallEmbed(call, pledges),
    buildComponents: (call)          => buildDefCallComponents(call),
  });
}

// ── Panel entry: call:def_active or call:def_perma ───────────────────────────
export async function handleDefCallButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const type = interaction.customId.split(':')[1]; // 'def_active' or 'def_perma'
  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const modal = new ModalBuilder().setCustomId(`combat:create_def:${type}`).setTitle(config.label);

  const coords = new TextInputBuilder().setCustomId('coords').setLabel('Defender coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(-12|34)').setMaxLength(20);
  const troops = new TextInputBuilder().setCustomId('troops_needed').setLabel('Troops needed (def value)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 15000').setMaxLength(10);
  const notes  = new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(coords));
  if (!config.noDeadline) {
    const arrival = new TextInputBuilder().setCustomId('arrival').setLabel('Impact time (UTC)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('14:30:45 · in 2h30m · 2026-05-30 14:30:45').setMaxLength(30);
    modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  }
  modal.addComponents(
    new ActionRowBuilder().addComponents(troops),
    new ActionRowBuilder().addComponents(notes),
  );
  await interaction.showModal(modal);
}

// ── Modal submit: combat:create_def:<type> ───────────────────────────────────
export async function handleDefCallCreateModal(interaction, sourceReportId = null) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const type = interaction.customId.split(':')[2];
  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const coordsStr = interaction.fields.getTextInputValue('coords');
  const coords = parseCoords(coordsStr);
  if (!coords) return interaction.reply({ content: `❌ Invalid coords: \`${coordsStr}\``, ephemeral: true });

  let arrival = null;
  if (!config.noDeadline) {
    arrival = parseDeadline(interaction.fields.getTextInputValue('arrival'));
    if (!arrival) return interaction.reply({ content: '❌ Invalid impact time.', ephemeral: true });
  }

  const troopsStr = interaction.fields.getTextInputValue('troops_needed').trim().replace(/[, ]/g, '');
  const troopsNeeded = parseInt(troopsStr, 10);
  if (!Number.isInteger(troopsNeeded) || troopsNeeded < 1 || troopsNeeded > 10_000_000) {
    return interaction.reply({ content: '❌ Troops needed must be a positive integer (1–10,000,000).', ephemeral: true });
  }

  const notes = interaction.fields.getTextInputValue('notes') || null;
  const payload = JSON.stringify({ troops_needed: troopsNeeded, notes, source_report_id: sourceReportId });

  const channelId = getDefCallsChannelId();
  if (!channelId) {
    return interaction.reply({ content: '❌ No def-calls channel configured. Run `/setup def-calls` first.', ephemeral: true });
  }

  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(type, interaction.user.id, coords.x, coords.y, arrival, channelId, payload);
  const callId = result.lastInsertRowid;
  inc('callsCreated');

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const channel = await interaction.client.channels.fetch(channelId);
  const mention = await getDefRoleMention(channel.guild);

  const msg = await channel.send({
    content: mention || '',
    embeds: [buildDefCallEmbed(call, [])],
    components: buildDefCallComponents(call),
    allowedMentions: { parse: ['roles'] },
  });
  prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);

  // If escalated from a report, patch the report and re-render it.
  if (sourceReportId) {
    prepare('UPDATE incoming_reports SET escalated_call_id = ? WHERE id = ?').run(callId, sourceReportId);
    try {
      const reportRow = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(sourceReportId);
      const reportsPanel = prepare('SELECT channel_id FROM panels WHERE type = ?').get('reports');
      if (reportRow?.reports_msg_id && reportsPanel) {
        const ch = await interaction.client.channels.fetch(reportsPanel.channel_id);
        const rmsg = await ch.messages.fetch(reportRow.reports_msg_id);
        const { buildReportEmbed, buildReportComponents } = await import('./incomingReports.js');
        await rmsg.edit({ embeds: [buildReportEmbed(reportRow)], components: buildReportComponents(reportRow) });
      }
    } catch (err) {
      logger.warn('report → call link re-render skipped:', err.message);
    }
  }

  await interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  return callId;
}

// ── combat:send_def:<callId> — first-time pledge opens modal; repeat shows Edit/Add ─
export async function handleSendDefButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }
  const existing = prepare('SELECT inf, cav FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing && ((existing.inf | 0) > 0 || (existing.cav | 0) > 0)) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`combat:send_def_edit:${callId}`).setStyle(ButtonStyle.Primary).setLabel('Edit pledge').setEmoji('✏️'),
      new ButtonBuilder().setCustomId(`combat:send_def_add:${callId}`).setStyle(ButtonStyle.Success).setLabel('Add to pledge').setEmoji('➕'),
    );
    return interaction.reply({
      content: `You already pledged: **${existing.inf | 0} inf / ${existing.cav | 0} cav**\nEdit replaces; Add appends.`,
      components: [row],
      ephemeral: true,
    });
  }
  await showSendDefModal(interaction, callId, 0, 0, `combat:send_def_submit:${callId}`, 'Sending Def');
}

async function showSendDefModal(interaction, callId, prefillInf, prefillCav, submitId, title) {
  const modal = new ModalBuilder().setCustomId(submitId).setTitle(title);
  const inf = new TextInputBuilder().setCustomId('inf').setLabel('Infantry (integer, 0 if none)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 1000').setMaxLength(10).setValue(String(prefillInf | 0));
  const cav = new TextInputBuilder().setCustomId('cav').setLabel('Cavalry (integer, 0 if none)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 500').setMaxLength(10).setValue(String(prefillCav | 0));
  modal.addComponents(new ActionRowBuilder().addComponents(inf), new ActionRowBuilder().addComponents(cav));
  await interaction.showModal(modal);
}

export async function handleSendDefEditButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const existing = prepare('SELECT inf, cav FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  await showSendDefModal(interaction, callId, existing?.inf | 0, existing?.cav | 0, `combat:send_def_submit:${callId}`, 'Edit pledge');
}

export async function handleSendDefAddButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  await showSendDefModal(interaction, callId, 0, 0, `combat:send_def_add_submit:${callId}`, 'Add to pledge');
}

function parseInfCav(interaction) {
  const inf = parseInt(interaction.fields.getTextInputValue('inf'), 10);
  const cav = parseInt(interaction.fields.getTextInputValue('cav'), 10);
  if (!Number.isInteger(inf) || inf < 0 || inf > 10_000_000) return { error: '❌ Inf must be an integer 0–10,000,000.' };
  if (!Number.isInteger(cav) || cav < 0 || cav > 10_000_000) return { error: '❌ Cav must be an integer 0–10,000,000.' };
  if (inf === 0 && cav === 0) return { error: '❌ At least one of Inf or Cav must be > 0.' };
  return { inf, cav };
}

export async function handleSendDefSubmitModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });

  const { inf, cav, error } = parseInfCav(interaction);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing) {
    prepare('UPDATE pledges SET inf = ?, cav = ?, amount = NULL WHERE call_id = ? AND user_id = ?').run(inf, cav, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, inf, cav) VALUES (?, ?, ?, ?)').run(callId, interaction.user.id, inf, cav);
  }
  inc('pledgesSubmitted');

  await refreshCall(interaction.client, callId);
  await maybeMarkFilled(interaction, callId);

  await interaction.reply({ content: `✅ Committed: ${inf} inf / ${cav} cav (${defValue(inf, cav)} def).`, ephemeral: true });
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
}

export async function handleSendDefAddSubmitModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });

  const { inf, cav, error } = parseInfCav(interaction);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const existing = prepare('SELECT inf, cav FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing) {
    const newInf = (existing.inf | 0) + inf;
    const newCav = (existing.cav | 0) + cav;
    prepare('UPDATE pledges SET inf = ?, cav = ?, amount = NULL WHERE call_id = ? AND user_id = ?').run(newInf, newCav, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, inf, cav) VALUES (?, ?, ?, ?)').run(callId, interaction.user.id, inf, cav);
  }
  inc('pledgesSubmitted');

  await refreshCall(interaction.client, callId);
  await maybeMarkFilled(interaction, callId);

  await interaction.reply({ content: `✅ Added: +${inf} inf / +${cav} cav.`, ephemeral: true });
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
}

// ── Mark filled, lock embed, archive to leadership channel ───────────────────
async function maybeMarkFilled(interaction, callId) {
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') return;
  const payload = JSON.parse(call.payload || '{}');
  const needed = payload.troops_needed | 0;
  const pledges = prepare('SELECT * FROM pledges WHERE call_id = ?').all(callId);
  const totalDef = pledges.reduce((s, p) => s + defValue(p.inf, p.cav), 0);
  if (needed > 0 && totalDef >= needed) {
    prepare("UPDATE calls SET status = 'filled' WHERE id = ?").run(callId);
    await refreshCall(interaction.client, callId);
    await postLeadershipArchive(interaction, callId);
    rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  }
}

async function postLeadershipArchive(interaction, callId) {
  const channelId = getLeadershipChannelId();
  if (!channelId) {
    logger.warn('No leadership channel set; skipping filled archive post.');
    return;
  }
  try {
    const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    const pledges = prepare('SELECT * FROM pledges WHERE call_id = ? ORDER BY created_at ASC').all(callId);
    const channel = await interaction.client.channels.fetch(channelId);

    const embed = buildDefCallEmbed(call, pledges);
    embed.setTitle(`📒 ARCHIVE — ${embed.data.title}`);

    let originLink = '';
    if (call.channel_id && call.message_id) {
      originLink = `https://discord.com/channels/${interaction.guild.id}/${call.channel_id}/${call.message_id}`;
      embed.addFields({ name: 'Original message', value: `[Jump](${originLink})`, inline: false });
    }
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn('leadership archive post failed:', err.message);
  }
}

export async function handleEscalateActiveButton(interaction) {
  return showEscalateModal(interaction, 'def_active', interaction.customId.split(':')[2]);
}

export async function handleEscalatePermaButton(interaction) {
  return showEscalateModal(interaction, 'def_perma', interaction.customId.split(':')[2]);
}

async function showEscalateModal(interaction, type, reportId) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }

  const report = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!report) return interaction.reply({ content: 'Report not found.', ephemeral: true });

  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const modal = new ModalBuilder()
    .setCustomId(`combat:create_def_from_report:${type}:${reportId}`)
    .setTitle(`${config.label} (from #${reportId})`);

  const coords = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Defender coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(formatCoords(report.defender_x, report.defender_y))
    .setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(coords));

  if (!config.noDeadline) {
    const arrival = new TextInputBuilder()
      .setCustomId('arrival')
      .setLabel('Impact time (UTC)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(formatDeadline(report.first_eta))
      .setMaxLength(30);
    modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  }

  const troops = new TextInputBuilder()
    .setCustomId('troops_needed')
    .setLabel('Troops needed (def value)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g. 15000')
    .setMaxLength(10);
  modal.addComponents(new ActionRowBuilder().addComponents(troops));

  const gap = avgWaveGapSec(report.wave_spread_sec, report.waves);
  const inbetweenMin = Number(prepare('SELECT value FROM config WHERE key=?').get('inbetween_min_gap_sec')?.value ?? '1');
  let notesPrefill = '';
  if (gap != null && gap >= inbetweenMin) {
    notesPrefill = `Wave gap ~${gap.toFixed(1)}s - in-between def possible`;
  }

  const notes = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  if (notesPrefill) notes.setValue(notesPrefill);
  modal.addComponents(new ActionRowBuilder().addComponents(notes));

  return interaction.showModal(modal);
}

// ── /active-def slash command ─────────────────────────────────────────────────
export async function handleActiveDefCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const coords = parseCoords(interaction.options.getString('coords'));
  if (!coords) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  const arrival = parseDeadline(interaction.options.getString('arrival'));
  if (!arrival) return interaction.reply({ content: '❌ Invalid impact time.', ephemeral: true });
  const troopsNeeded = interaction.options.getInteger('troops_needed');
  const notes = interaction.options.getString('notes');
  await createDefCallDirect(interaction, 'def_active', coords, arrival, troopsNeeded, notes, null);
}

// ── /perma-def slash command ──────────────────────────────────────────────────
export async function handlePermaDefCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const coords = parseCoords(interaction.options.getString('coords'));
  if (!coords) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  const troopsNeeded = interaction.options.getInteger('troops_needed');
  const notes = interaction.options.getString('notes');
  await createDefCallDirect(interaction, 'def_perma', coords, null, troopsNeeded, notes, null);
}

async function createDefCallDirect(interaction, type, coords, arrival, troopsNeeded, notes, sourceReportId) {
  const channelId = getDefCallsChannelId();
  if (!channelId) return interaction.reply({ content: '❌ No def-calls channel configured.', ephemeral: true });
  const payload = JSON.stringify({ troops_needed: troopsNeeded, notes: notes ?? null, source_report_id: sourceReportId });
  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(type, interaction.user.id, coords.x, coords.y, arrival, channelId, payload);
  const callId = result.lastInsertRowid;
  inc('callsCreated');

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const channel = await interaction.client.channels.fetch(channelId);
  const mention = await getDefRoleMention(channel.guild);
  const msg = await channel.send({
    content: mention || '',
    embeds: [buildDefCallEmbed(call, [])],
    components: buildDefCallComponents(call),
    allowedMentions: { parse: ['roles'] },
  });
  prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  await interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
}

// ── /sending-def slash command ────────────────────────────────────────────────
export async function handleSendingDefCommand(interaction) {
  const callId = interaction.options.getInteger('call');
  const inf = interaction.options.getInteger('inf');
  const cav = interaction.options.getInteger('cav');
  if (inf === 0 && cav === 0) return interaction.reply({ content: '❌ At least one of Inf or Cav must be > 0.', ephemeral: true });

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open' || (call.type !== 'def_active' && call.type !== 'def_perma')) {
    return interaction.reply({ content: '❌ Call not found or not open.', ephemeral: true });
  }
  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing) {
    prepare('UPDATE pledges SET inf = ?, cav = ?, amount = NULL WHERE call_id = ? AND user_id = ?').run(inf, cav, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, inf, cav) VALUES (?, ?, ?, ?)').run(callId, interaction.user.id, inf, cav);
  }
  inc('pledgesSubmitted');
  await refreshCall(interaction.client, callId);
  await maybeMarkFilled(interaction, callId);
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  await interaction.reply({ content: `✅ Pledged ${inf} inf / ${cav} cav (${defValue(inf, cav)} def).`, ephemeral: true });
}

export async function handleDefCallFromReportModal(interaction) {
  const parts = interaction.customId.split(':');
  const type = parts[2];
  const reportId = parseInt(parts[3], 10);
  const forwarded = Object.create(interaction);
  Object.defineProperty(forwarded, 'customId', {
    value: `combat:create_def:${type}`,
    configurable: true,
  });
  return handleDefCallCreateModal(forwarded, reportId);
}
