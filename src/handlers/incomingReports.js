// src/handlers/incomingReports.js
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { discordTimestamp, parseDeadline } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { getHomeCoordsString } from './profile.js';
import { avgWaveGapSec } from '../utils/defMath.js';
import { classifyAndPersist, cascadeChiefFrom } from './threat.js';
import { isLeadershipOrCoord } from '../utils/tier.js';

// Stub for future paste-mode (Section 3 of spec). Returns null until implemented.
export function parseRallyPointPaste(/* pastedText */) {
  return null;
}

const BADGE = {
  fake:    '🟢 LIKELY FAKE',
  real:    '🟠 LIKELY REAL',
  chief:   '🔴 CHIEF ATTEMPT',
  unknown: '⚪ UNCLASSIFIED',
};
const BADGE_COLOR = {
  fake:    0x2ecc71,
  real:    0xe67e22,
  chief:   0xe74c3c,
  unknown: 0x95a5a6,
};

function effectiveClass(row) {
  return row.threat_override || row.threat_class || 'unknown';
}

function badgeLabel(row) {
  const cls = effectiveClass(row);
  const base = BADGE[cls] ?? BADGE.unknown;
  return row.threat_override ? `${base} (manual)` : base;
}

function xworldLookup(x, y) {
  try {
    const r = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y);
    if (!r?.player) return '';
    return ` — ${r.player}${r.alliance ? ` [${r.alliance}]` : ''}`;
  } catch (err) {
    logger.warn(`xworld lookup for (${x}|${y}) failed:`, err.message);
    return '';
  }
}

export function buildReportEmbed(row) {
  const cls = effectiveClass(row);
  const embed = new EmbedBuilder()
    .setColor(BADGE_COLOR[cls] ?? BADGE_COLOR.unknown)
    .setTitle(`📥 INCOMING ATTACK  ${badgeLabel(row)}`)
    .addFields(
      { name: 'Reporter', value: `<@${row.reporter_id}>`, inline: true },
      { name: 'Defender', value: `[${formatCoords(row.defender_x, row.defender_y)}](${mapUrl(row.defender_x, row.defender_y)})${xworldLookup(row.defender_x, row.defender_y)}`, inline: true },
      { name: 'Attacker', value: `[${formatCoords(row.attacker_x, row.attacker_y)}](${mapUrl(row.attacker_x, row.attacker_y)})${xworldLookup(row.attacker_x, row.attacker_y)}`, inline: true },
      { name: 'Impact',   value: `${discordTimestamp(row.first_eta, 'D')} ${discordTimestamp(row.first_eta, 'T')} (${discordTimestamp(row.first_eta, 'R')})`, inline: false },
      { name: 'Waves',    value: String(row.waves), inline: true },
    );

  const gap = avgWaveGapSec(row.wave_spread_sec, row.waves);
  if (row.wave_spread_sec != null) {
    const gapStr = gap != null ? `avg gap ~${gap.toFixed(1)}s` : 'single wave';
    let line = `⏱️ ${row.waves} waves over ${row.wave_spread_sec}s (${gapStr})`;
    const inbetweenMin = Number(prepare('SELECT value FROM config WHERE key=?').get('inbetween_min_gap_sec')?.value ?? '1');
    if (gap != null && gap >= inbetweenMin) line += '  🛡️ IN-BETWEEN DEF POSSIBLE';
    else line += ' — no in-between window';
    embed.addFields({ name: 'Wave timing', value: line, inline: false });
  }

  if (row.notes) embed.addFields({ name: 'Notes', value: row.notes, inline: false });
  if (row.escalated_call_id) embed.addFields({ name: 'Status', value: `✅ Escalated → Call #${row.escalated_call_id}`, inline: false });
  if (row.status === 'dismissed') embed.addFields({ name: 'Status', value: '🔒 Closed', inline: false });

  embed.setFooter({ text: `Report ID: ${row.id}` }).setTimestamp();
  return embed;
}

export function buildReportComponents(row) {
  if (row.status === 'dismissed' || row.escalated_call_id) return [];
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report:escalate_active:${row.id}`).setStyle(ButtonStyle.Danger).setLabel('Escalate → Active Def').setEmoji('⚔️'),
    new ButtonBuilder().setCustomId(`report:escalate_perma:${row.id}`).setStyle(ButtonStyle.Primary).setLabel('Escalate → Perma Def').setEmoji('🛡️'),
    new ButtonBuilder().setCustomId(`report:reclassify:${row.id}`).setStyle(ButtonStyle.Secondary).setLabel('Reclassify').setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`report:close:${row.id}`).setStyle(ButtonStyle.Secondary).setLabel('Close').setEmoji('🔒'),
  );
  return [r1];
}

function getReportsChannelId() {
  const row = prepare('SELECT channel_id FROM panels WHERE type = ?').get('reports');
  return row?.channel_id ?? null;
}

async function getRoleMentionByEnv(guild, envKey) {
  const name = process.env[envKey];
  if (!name) return null;
  let role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!role) {
    try { const fetched = await guild.roles.fetch(); role = fetched.find(r => r.name.toLowerCase() === name.toLowerCase()); }
    catch { /* ignore */ }
  }
  return role ? `<@&${role.id}>` : null;
}

/**
 * Shared writer used by both manual and (future) paste paths.
 * @param {import('discord.js').Interaction} interaction
 * @param {{ defender:{x,y}, attacker:{x,y}, firstEta:number, waves:number, waveSpreadSec?:number|null, notes?:string|null }} fields
 */
export async function createIncomingReport(interaction, fields) {
  const result = prepare(`
    INSERT INTO incoming_reports
      (reporter_id, defender_x, defender_y, attacker_x, attacker_y, first_eta, waves, wave_spread_sec, notes, threat_class)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')
  `).run(
    interaction.user.id,
    fields.defender.x, fields.defender.y,
    fields.attacker.x, fields.attacker.y,
    fields.firstEta, fields.waves,
    fields.waveSpreadSec ?? null,
    fields.notes ?? null,
  );
  const id = result.lastInsertRowid;
  inc('reportsSubmitted');

  classifyAndPersist(id);
  const cascadedIds = cascadeChiefFrom(id);
  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(id);

  const channelId = getReportsChannelId();
  if (!channelId) {
    await interaction.reply({ content: '✅ Report saved, but no reports channel is configured. Run `/setup reports` in the reports channel.', ephemeral: true });
    return id;
  }

  const channel = await interaction.client.channels.fetch(channelId);
  const leadMention = await getRoleMentionByEnv(channel.guild, 'LEADERSHIP_ROLE_NAME');
  const coordMention = await getRoleMentionByEnv(channel.guild, 'DEF_COORD_ROLE_NAME');
  const content = [leadMention, coordMention].filter(Boolean).join(' ');

  const msg = await channel.send({
    content,
    embeds: [buildReportEmbed(row)],
    components: buildReportComponents(row),
    allowedMentions: { parse: ['roles'] },
  });
  prepare('UPDATE incoming_reports SET reports_msg_id = ? WHERE id = ?').run(msg.id, id);

  await interaction.reply({ content: `✅ Report #${id} submitted.`, ephemeral: true });

  // Re-render any reports cascaded to 'chief'.
  for (const cid of cascadedIds) {
    try {
      const cr = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(cid);
      if (!cr?.reports_msg_id) continue;
      const ch = await interaction.client.channels.fetch(channelId);
      const m = await ch.messages.fetch(cr.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(cr)], components: buildReportComponents(cr) });
    } catch (err) {
      logger.warn(`cascade re-render skipped for report ${cid}:`, err.message);
    }
  }

  return id;
}

// ── Entry: panel button report:choose ────────────────────────────────────────
export async function handleReportChooseButton(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('report:paste').setStyle(ButtonStyle.Secondary).setLabel('Paste from rally point').setEmoji('📋'),
    new ButtonBuilder().setCustomId('report:manual').setStyle(ButtonStyle.Primary).setLabel('Enter manually').setEmoji('✍️'),
  );
  await interaction.reply({
    content: 'How do you want to file this report?',
    components: [row],
    ephemeral: true,
  });
}

export async function handleReportPasteButton(interaction) {
  await interaction.reply({ content: '🚧 Paste mode coming soon. Use "Enter manually" for now.', ephemeral: true });
}

// ── report:manual → open modal ───────────────────────────────────────────────
export async function handleReportManualButton(interaction) {
  const modal = new ModalBuilder().setCustomId('report:manual_submit').setTitle('Report Incoming Attack');

  const def = new TextInputBuilder().setCustomId('defender').setLabel('Defender coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(-12|34)').setMaxLength(20);
  try { const home = getHomeCoordsString(interaction.user.id); if (home) def.setValue(home); } catch { /* no profile */ }

  const atk = new TextInputBuilder().setCustomId('attacker').setLabel('Attacker coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(56|-78)').setMaxLength(20);
  const eta = new TextInputBuilder().setCustomId('first_eta').setLabel('First wave ETA (UTC)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('14:30:45 · in 2h30m · 2026-05-30 14:30:45').setMaxLength(30);
  const waves = new TextInputBuilder().setCustomId('waves').setLabel('Number of waves (1-100)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3);
  const spread = new TextInputBuilder().setCustomId('wave_spread_sec').setLabel('Wave spread in seconds (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g. 6 = first→last wave over 6s').setMaxLength(5);

  modal.addComponents(
    new ActionRowBuilder().addComponents(def),
    new ActionRowBuilder().addComponents(atk),
    new ActionRowBuilder().addComponents(eta),
    new ActionRowBuilder().addComponents(waves),
    new ActionRowBuilder().addComponents(spread),
  );
  await interaction.showModal(modal);
}

// ── report:manual_submit ─────────────────────────────────────────────────────
export async function handleReportManualModal(interaction) {
  const f = name => interaction.fields.getTextInputValue(name);

  const defStr = f('defender'); const atkStr = f('attacker');
  const defender = parseCoords(defStr);
  if (!defender) return interaction.reply({ content: `❌ Invalid defender coords: \`${defStr}\``, ephemeral: true });
  const attacker = parseCoords(atkStr);
  if (!attacker) return interaction.reply({ content: `❌ Invalid attacker coords: \`${atkStr}\``, ephemeral: true });

  const firstEta = parseDeadline(f('first_eta'));
  if (!firstEta) return interaction.reply({ content: '❌ Invalid first wave ETA.', ephemeral: true });

  const waves = parseInt(f('waves'), 10);
  if (!Number.isInteger(waves) || waves < 1 || waves > 100) {
    return interaction.reply({ content: '❌ Waves must be an integer 1–100.', ephemeral: true });
  }

  const spreadStr = f('wave_spread_sec').trim();
  let waveSpreadSec = null;
  if (spreadStr) {
    waveSpreadSec = parseInt(spreadStr, 10);
    if (!Number.isInteger(waveSpreadSec) || waveSpreadSec < 0 || waveSpreadSec > 3600) {
      return interaction.reply({ content: '❌ Wave spread must be an integer 0–3600 seconds (or leave blank).', ephemeral: true });
    }
  }

  await createIncomingReport(interaction, { defender, attacker, firstEta, waves, waveSpreadSec, notes: null });
}

// ── report:reclassify button ─────────────────────────────────────────────────
export async function handleReclassifyButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const reportId = interaction.customId.split(':')[2];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`report:reclassify_pick:${reportId}`)
    .setPlaceholder('New classification')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('🟢 Fake').setValue('fake'),
      new StringSelectMenuOptionBuilder().setLabel('🟠 Real').setValue('real'),
      new StringSelectMenuOptionBuilder().setLabel('🔴 Chief').setValue('chief'),
      new StringSelectMenuOptionBuilder().setLabel('⚙️ Auto (clear override)').setValue('auto'),
    );
  await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
}

// ── report:reclassify_pick select ────────────────────────────────────────────
export async function handleReclassifySelect(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.update({ content: '❌ Leadership / Def Coord only.', components: [] });
  }
  const reportId = interaction.customId.split(':')[2];
  const choice = interaction.values[0];

  if (choice === 'auto') {
    prepare('UPDATE incoming_reports SET threat_override = NULL WHERE id = ?').run(reportId);
    classifyAndPersist(reportId);
  } else {
    prepare('UPDATE incoming_reports SET threat_override = ? WHERE id = ?').run(choice, reportId);
  }

  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  const channelId = getReportsChannelId();
  if (row?.reports_msg_id && channelId) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      const m = await ch.messages.fetch(row.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(row)], components: buildReportComponents(row) });
    } catch (err) {
      logger.warn(`reclassify re-render skipped:`, err.message);
    }
  }
  await interaction.update({ content: `✅ Report #${reportId} reclassified.`, components: [] });
}

// ── report:close button ──────────────────────────────────────────────────────
export async function handleReportCloseButton(interaction) {
  const reportId = interaction.customId.split(':')[2];
  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!row) return interaction.reply({ content: 'Report not found.', ephemeral: true });
  const isReporter = row.reporter_id === interaction.user.id;
  if (!isReporter && !isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Only the reporter, Leadership, or Def Coord can close this.', ephemeral: true });
  }
  prepare("UPDATE incoming_reports SET status = 'dismissed' WHERE id = ?").run(reportId);
  const after = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  const channelId = getReportsChannelId();
  if (after?.reports_msg_id && channelId) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      const m = await ch.messages.fetch(after.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(after)], components: buildReportComponents(after) });
    } catch (err) {
      logger.warn(`report close re-render skipped:`, err.message);
    }
  }
  await interaction.reply({ content: `🔒 Report #${reportId} closed.`, ephemeral: true });
}
