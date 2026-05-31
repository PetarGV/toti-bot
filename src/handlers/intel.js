import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { formatCoords, parseCoords } from '../utils/coords.js';
import { discordTimestamp } from '../utils/time.js';
import { avgWaveGapSec, chebyshev, defValue } from '../utils/defMath.js';
import { isLeadershipOrCoord } from '../utils/tier.js';
import { logger } from '../utils/logger.js';

const DASHBOARD_MSG_KEY = 'intel_dashboard_msg_id';
const DEFAULT_WINDOW_SEC = 24 * 3600;

function effective(row) {
  return row.threat_override || row.threat_class || 'unknown';
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function rankHotTargets(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.defender_x},${row.defender_y}`;
    const entry = map.get(key) ?? {
      defender_x: row.defender_x,
      defender_y: row.defender_y,
      reports: 0,
      chief: 0,
      peak_eta: row.first_eta ?? 0,
    };
    entry.reports += 1;
    if (effective(row) === 'chief') entry.chief += 1;
    entry.peak_eta = Math.max(entry.peak_eta ?? 0, row.first_eta ?? 0);
    map.set(key, entry);
  }

  return [...map.values()]
    .map(entry => ({ ...entry, score: entry.reports * 2 + entry.chief * 5 }))
    .sort((a, b) => (b.score - a.score) || ((b.peak_eta ?? 0) - (a.peak_eta ?? 0)));
}

export function focusOrScatter(defenders, radius) {
  for (let i = 0; i < defenders.length; i += 1) {
    for (let j = i + 1; j < defenders.length; j += 1) {
      if (chebyshev(defenders[i], defenders[j]) > radius) return 'scattered';
    }
  }
  return 'focused';
}

function xworldName(x, y) {
  try {
    const row = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y);
    if (!row?.player) return '';
    return ` ${row.player}${row.alliance ? ` [${row.alliance}]` : ''}`;
  } catch {
    return '';
  }
}

function cfgNumber(key, fallback) {
  const row = prepare('SELECT value FROM config WHERE key = ?').get(key);
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function safeJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

export function buildDashboardEmbed({ windowSec = DEFAULT_WINDOW_SEC } = {}) {
  const since = unixNow() - windowSec;
  const reports = prepare('SELECT * FROM incoming_reports WHERE created_at > ?').all(since);
  const openCalls = prepare("SELECT * FROM calls WHERE status = 'open' AND type IN ('def_active','def_perma')").all();
  const scatterRadius = cfgNumber('threat_scatter_radius', 5);
  const inbetweenMin = cfgNumber('inbetween_min_gap_sec', 1);

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`🧠 ALLIANCE INTEL — last ${Math.round(windowSec / 3600)}h`)
    .setTimestamp();

  const hotTargets = rankHotTargets(reports).slice(0, 5);
  if (hotTargets.length) {
    const lines = hotTargets.map(target =>
      `${formatCoords(target.defender_x, target.defender_y)}${xworldName(target.defender_x, target.defender_y)} — ${plural(target.reports, 'report')}, ${target.chief} chief`
    );
    embed.addFields({ name: '🔥 Hot targets', value: lines.join('\n'), inline: false });
  }

  const attackers = new Map();
  for (const report of reports) {
    const key = `${report.attacker_x},${report.attacker_y}`;
    const entry = attackers.get(key) ?? {
      attacker_x: report.attacker_x,
      attacker_y: report.attacker_y,
      count: 0,
      defenders: new Set(),
    };
    entry.count += 1;
    entry.defenders.add(`${report.defender_x},${report.defender_y}`);
    attackers.set(key, entry);
  }

  const topAttackers = [...attackers.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  if (topAttackers.length) {
    const lines = topAttackers.map(attacker => {
      const defenders = [...attacker.defenders].map(value => {
        const [x, y] = value.split(',').map(Number);
        return { x, y };
      });
      const label = defenders.length > 1 ? focusOrScatter(defenders, scatterRadius) : 'focused';
      return `${formatCoords(attacker.attacker_x, attacker.attacker_y)}${xworldName(attacker.attacker_x, attacker.attacker_y)} — ${plural(attacker.count, 'report')} across ${plural(attacker.defenders.size, 'defender')} (${label})`;
    });
    embed.addFields({ name: '⚔️ Top attackers', value: lines.join('\n'), inline: false });
  }

  if (openCalls.length) {
    const lines = openCalls.slice(0, 5).map(call => {
      const payload = safeJson(call.payload);
      const pledges = prepare('SELECT * FROM pledges WHERE call_id = ?').all(call.id);
      const totalDef = pledges.reduce((sum, pledge) => sum + defValue(pledge.inf, pledge.cav), 0);
      const needed = payload.troops_needed | 0;
      const pct = needed > 0 ? Math.round(100 * Math.min(1, totalDef / needed)) : 0;
      const typeLabel = call.type === 'def_active' ? 'Active Def' : 'Perma Def';
      const eta = call.deadline ? ` — ETA ${discordTimestamp(call.deadline, 'R')}` : ' — no ETA';
      return `#${call.id} ${typeLabel} ${formatCoords(call.x, call.y)} ${pct}% (${totalDef}/${needed} def)${eta}`;
    });
    embed.addFields({ name: '🛡️ Open def calls', value: lines.join('\n'), inline: false });
  }

  if (reports.length) {
    const tally = { fake: 0, real: 0, chief: 0, unknown: 0 };
    for (const report of reports) {
      const key = effective(report);
      tally[key] = (tally[key] ?? 0) + 1;
    }
    embed.addFields({
      name: '📊 Threat tally',
      value: `🟢 Fake ${tally.fake}   🟠 Real ${tally.real}   🔴 Chief ${tally.chief}   ⚪ Unknown ${tally.unknown}`,
      inline: false,
    });
  }

  const inbetween = reports
    .filter(report => report.wave_spread_sec != null && report.waves > 1)
    .map(report => ({ report, gap: avgWaveGapSec(report.wave_spread_sec, report.waves) }))
    .filter(({ gap }) => gap != null && gap >= inbetweenMin)
    .sort((a, b) => a.report.first_eta - b.report.first_eta)
    .slice(0, 5);
  if (inbetween.length) {
    const lines = inbetween.map(({ report, gap }) =>
      `${formatCoords(report.defender_x, report.defender_y)} <- ${formatCoords(report.attacker_x, report.attacker_y)}: ${report.waves} waves over ${report.wave_spread_sec}s (~${gap.toFixed(1)}s gap) — ${discordTimestamp(report.first_eta, 'R')}`
    );
    embed.addFields({ name: '⏱️ In-between def opportunities', value: lines.join('\n'), inline: false });
  }

  const roundStart = cfgNumber('round_start_at', 0);
  const leaders = prepare(`
    SELECT p.user_id AS user_id,
           SUM(COALESCE(p.inf, 0) + COALESCE(p.cav, 0) * 2) AS def_sent,
           COUNT(DISTINCT p.call_id) AS calls
    FROM pledges p
    JOIN calls c ON p.call_id = c.id
    WHERE c.type IN ('def_active','def_perma')
      AND c.created_at > ?
    GROUP BY p.user_id
    ORDER BY def_sent DESC
    LIMIT 5
  `).all(roundStart);
  if (leaders.length) {
    const lines = leaders.map(row => `<@${row.user_id}> — ${Math.round((row.def_sent ?? 0) / 1000)}k def sent across ${plural(row.calls, 'call')}`);
    embed.addFields({ name: 'Round leaderboard (top defenders)', value: lines.join('\n'), inline: false });
  }

  return embed;
}

export function buildDashboardComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('intel:refresh').setStyle(ButtonStyle.Secondary).setLabel('Refresh').setEmoji('🔄'),
      new ButtonBuilder().setCustomId('intel:target').setStyle(ButtonStyle.Secondary).setLabel('Target drill-down').setEmoji('🎯'),
      new ButtonBuilder().setCustomId('intel:attacker').setStyle(ButtonStyle.Secondary).setLabel('Attacker drill-down').setEmoji('⚔️'),
      new ButtonBuilder().setCustomId('intel:window').setStyle(ButtonStyle.Secondary).setLabel('Wider window').setEmoji('📅'),
    ),
  ];
}

function getLeadershipChannelId() {
  return prepare('SELECT value FROM config WHERE key=?').get('leadership_channel_id')?.value ?? null;
}

export async function rebuildDashboard(client) {
  const channelId = getLeadershipChannelId();
  if (!channelId) return;

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    logger.warn('intel dashboard: leadership channel fetch failed:', err.message);
    return;
  }

  const embed = buildDashboardEmbed();
  const components = buildDashboardComponents();
  const existing = prepare('SELECT value FROM config WHERE key = ?').get(DASHBOARD_MSG_KEY);

  if (existing?.value) {
    try {
      const message = await channel.messages.fetch(existing.value);
      await message.edit({ embeds: [embed], components });
      return;
    } catch {
      // Post a fresh dashboard below.
    }
  }

  const message = await channel.send({ embeds: [embed], components });
  try {
    await message.pin();
  } catch {
    // Pinning is best-effort.
  }
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(DASHBOARD_MSG_KEY, message.id);
}

export function buildTargetDrillEmbed(x, y, windowSec = DEFAULT_WINDOW_SEC) {
  const since = unixNow() - windowSec;
  const reports = prepare(
    'SELECT * FROM incoming_reports WHERE defender_x = ? AND defender_y = ? AND created_at > ? ORDER BY first_eta ASC'
  ).all(x, y, since);
  const openCalls = prepare(
    "SELECT * FROM calls WHERE x = ? AND y = ? AND status = 'open' AND type IN ('def_active','def_perma')"
  ).all(x, y);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🎯 Target drill-down — ${formatCoords(x, y)}${xworldName(x, y)}`)
    .setTimestamp();

  if (!reports.length) {
    embed.setDescription('No reports against this defender in the selected window.');
  } else {
    const tally = { fake: 0, real: 0, chief: 0, unknown: 0 };
    for (const report of reports) {
      const key = effective(report);
      tally[key] = (tally[key] ?? 0) + 1;
    }
    embed.addFields({
      name: 'Threat breakdown',
      value: `🟢 ${tally.fake}   🟠 ${tally.real}   🔴 ${tally.chief}   ⚪ ${tally.unknown}`,
      inline: false,
    });
    const lines = reports.slice(0, 15).map(report =>
      `${discordTimestamp(report.first_eta, 'R')} from ${formatCoords(report.attacker_x, report.attacker_y)} — ${report.waves}w, ${effective(report)}`
    );
    embed.addFields({ name: `Reports (${reports.length})`, value: lines.join('\n'), inline: false });
  }

  if (openCalls.length) {
    const lines = openCalls.map(call =>
      `#${call.id} ${call.type === 'def_active' ? 'Active' : 'Perma'} — ${call.deadline ? discordTimestamp(call.deadline, 'R') : 'no ETA'}`
    );
    embed.addFields({ name: 'Open def calls', value: lines.join('\n'), inline: false });
  }

  return embed;
}

export function buildAttackerDrillEmbed(x, y, windowSec = DEFAULT_WINDOW_SEC) {
  const since = unixNow() - windowSec;
  const reports = prepare(
    'SELECT * FROM incoming_reports WHERE attacker_x = ? AND attacker_y = ? AND created_at > ? ORDER BY first_eta ASC'
  ).all(x, y, since);
  const scatterRadius = cfgNumber('threat_scatter_radius', 5);

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`⚔️ Attacker drill-down — ${formatCoords(x, y)}${xworldName(x, y)}`)
    .setTimestamp();

  if (!reports.length) {
    embed.setDescription('No reports from this attacker in the selected window.');
    return embed;
  }

  const defenders = [...new Set(reports.map(report => `${report.defender_x},${report.defender_y}`))]
    .map(value => {
      const [dx, dy] = value.split(',').map(Number);
      return { x: dx, y: dy };
    });
  const pattern = defenders.length > 1 ? focusOrScatter(defenders, scatterRadius) : 'focused';

  embed.addFields({ name: 'Pattern', value: `${plural(reports.length, 'report')} across ${plural(defenders.length, 'defender')} (${pattern})`, inline: false });
  const lines = reports.slice(0, 15).map(report =>
    `${discordTimestamp(report.first_eta, 'R')} -> ${formatCoords(report.defender_x, report.defender_y)} — ${report.waves}w, ${effective(report)}`
  );
  embed.addFields({ name: 'Reports', value: lines.join('\n'), inline: false });
  return embed;
}

// ── /intel slash command ──────────────────────────────────────────────────────
export async function handleIntelCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const days = interaction.options.getInteger('days');
  const targetStr = interaction.options.getString('target');
  const attackerStr = interaction.options.getString('attacker');
  const windowSec = (days ? days : 1) * 86400;

  if (targetStr) {
    const c = parseCoords(targetStr);
    if (!c) return interaction.reply({ content: '❌ Invalid target coords.', ephemeral: true });
    return interaction.reply({ embeds: [buildTargetDrillEmbed(c.x, c.y, windowSec)], ephemeral: true });
  }
  if (attackerStr) {
    const c = parseCoords(attackerStr);
    if (!c) return interaction.reply({ content: '❌ Invalid attacker coords.', ephemeral: true });
    return interaction.reply({ embeds: [buildAttackerDrillEmbed(c.x, c.y, windowSec)], ephemeral: true });
  }
  await interaction.reply({ embeds: [buildDashboardEmbed({ windowSec })], ephemeral: true });
}

// ── /reclassify slash command ─────────────────────────────────────────────────
export async function handleReclassifyCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const reportId = interaction.options.getInteger('report');
  const choice = interaction.options.getString('as');
  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!row) return interaction.reply({ content: 'Report not found.', ephemeral: true });

  if (choice === 'auto') {
    prepare('UPDATE incoming_reports SET threat_override = NULL WHERE id = ?').run(reportId);
    const { classifyAndPersist } = await import('./threat.js');
    classifyAndPersist(reportId);
  } else {
    prepare('UPDATE incoming_reports SET threat_override = ? WHERE id = ?').run(choice, reportId);
  }
  const after = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  const reportsChannelId = prepare('SELECT value FROM config WHERE key=?').get('reports_channel_id')?.value ?? null;
  if (after?.reports_msg_id && reportsChannelId) {
    try {
      const { buildReportEmbed, buildReportComponents } = await import('./incomingReports.js');
      const ch = await interaction.client.channels.fetch(reportsChannelId);
      const m = await ch.messages.fetch(after.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(after)], components: buildReportComponents(after) });
    } catch (err) { logger.warn('reclassify command re-render skipped:', err.message); }
  }
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  await interaction.reply({ content: `✅ Report #${reportId} reclassified.`, ephemeral: true });
}

export async function handleIntelRefreshButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  await rebuildDashboard(interaction.client);
  return interaction.editReply({ content: '✅ Dashboard refreshed.' });
}

export async function handleIntelTargetButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const modal = new ModalBuilder().setCustomId('intel:target_submit').setTitle('Target drill-down');
  const coords = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Defender coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('(-12|34)')
    .setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(coords));
  return interaction.showModal(modal);
}

export async function handleIntelAttackerButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const modal = new ModalBuilder().setCustomId('intel:attacker_submit').setTitle('Attacker drill-down');
  const coords = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Attacker coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('(56|-78)')
    .setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(coords));
  return interaction.showModal(modal);
}

export async function handleIntelTargetModal(interaction) {
  const coords = parseCoords(interaction.fields.getTextInputValue('coords'));
  if (!coords) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  return interaction.reply({ embeds: [buildTargetDrillEmbed(coords.x, coords.y, DEFAULT_WINDOW_SEC)], ephemeral: true });
}

export async function handleIntelAttackerModal(interaction) {
  const coords = parseCoords(interaction.fields.getTextInputValue('coords'));
  if (!coords) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  return interaction.reply({ embeds: [buildAttackerDrillEmbed(coords.x, coords.y, DEFAULT_WINDOW_SEC)], ephemeral: true });
}

export async function handleIntelWindowButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('intel:window_pick')
    .setPlaceholder('Pick window')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('1 day').setValue('1'),
      new StringSelectMenuOptionBuilder().setLabel('3 days').setValue('3'),
      new StringSelectMenuOptionBuilder().setLabel('7 days').setValue('7'),
      new StringSelectMenuOptionBuilder().setLabel('14 days').setValue('14'),
      new StringSelectMenuOptionBuilder().setLabel('30 days').setValue('30'),
    );
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
}

export async function handleIntelWindowSelect(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.update({ content: '❌ Leadership / Def Coord only.', embeds: [], components: [] });
  }
  const days = parseInt(interaction.values[0], 10);
  return interaction.update({ embeds: [buildDashboardEmbed({ windowSec: days * 86400 })], components: [] });
}
