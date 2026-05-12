import { EmbedBuilder } from 'discord.js';
import { prepare } from '../db/client.js';
import { formatAmount } from '../utils/resources.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { normalizeIgn } from '../utils/ign.js';

const MEDALS = ['🥇', '🥈', '🥉'];

function rankedLine(i, line) {
  const prefix = MEDALS[i] ?? `**${i + 1}.**`;
  return `${prefix} ${line}`;
}

// Group raw per-Discord-ID rows into per-IGN buckets (users without an IGN
// stay as their own bucket, keyed by discord_id). Each bucket aggregates
// the numeric `valueKey` field via the supplied combine function.
export function groupByIgn(rows, valueKeys) {
  const ignToBucket = new Map();
  const userToIgn = new Map();
  if (rows.length) {
    const ignRows = prepare('SELECT discord_id, ign FROM user_ign_links WHERE is_primary = 1').all();
    for (const r of ignRows) userToIgn.set(r.discord_id, r.ign);
  }

  for (const row of rows) {
    const ign = userToIgn.get(row.user_id) ?? null;
    const norm = normalizeIgn(ign);
    const key = norm || `__solo__:${row.user_id}`;

    let bucket = ignToBucket.get(key);
    if (!bucket) {
      bucket = { ign, user_ids: [], ...Object.fromEntries(valueKeys.map(k => [k, 0])) };
      ignToBucket.set(key, bucket);
    }
    if (!bucket.user_ids.includes(row.user_id)) bucket.user_ids.push(row.user_id);
    for (const k of valueKeys) bucket[k] += row[k] ?? 0;
  }

  return [...ignToBucket.values()];
}

function topPushSenders() {
  const rows = prepare(`
    SELECT pledges.user_id, SUM(CAST(pledges.amount AS INTEGER)) AS total, COUNT(*) AS pushes
    FROM pledges
    JOIN calls ON calls.id = pledges.call_id
    WHERE calls.type LIKE 'push:%'
    GROUP BY pledges.user_id
  `).all();
  return groupByIgn(rows, ['total', 'pushes']).sort((a, b) => b.total - a.total).slice(0, 10);
}

function topDefenders() {
  const rows = prepare(`
    SELECT pledges.user_id, COUNT(*) AS responses
    FROM pledges
    JOIN calls ON calls.id = pledges.call_id
    WHERE calls.type IN ('defense', 'reinforce', 'urgent')
    GROUP BY pledges.user_id
  `).all();
  return groupByIgn(rows, ['responses']).sort((a, b) => b.responses - a.responses).slice(0, 10);
}

function topScouts() {
  const rows = prepare(`
    SELECT pledges.user_id, COUNT(*) AS reports
    FROM pledges
    JOIN calls ON calls.id = pledges.call_id
    WHERE calls.type = 'scout' AND pledges.amount IS NOT NULL AND pledges.amount != 'On it'
    GROUP BY pledges.user_id
  `).all();
  return groupByIgn(rows, ['reports']).sort((a, b) => b.reports - a.reports).slice(0, 10);
}

function topRequesters() {
  const rows = prepare(`
    SELECT author_id AS user_id, COUNT(*) AS calls_made
    FROM calls
    GROUP BY author_id
  `).all();
  return groupByIgn(rows, ['calls_made']).sort((a, b) => b.calls_made - a.calls_made).slice(0, 10);
}

// "Pesho (3-dual)" if grouped, otherwise "<@id>" for solo Discord users with no IGN.
function nameFor(bucket) {
  if (bucket.ign) {
    const suffix = bucket.user_ids.length > 1 ? ` _(${bucket.user_ids.length}-dual)_` : '';
    return `**${bucket.ign}**${suffix}`;
  }
  return `<@${bucket.user_ids[0]}>`;
}

function renderList(rows, formatRow) {
  if (!rows.length) return '*No data yet*';
  return rows.map((r, i) => rankedLine(i, formatRow(r))).join('\n');
}

export async function handleLeaderboardCommand(interaction) {
  const category = interaction.options.getString('category') ?? 'pushers';

  let title, color, body;

  switch (category) {
    case 'defenders': {
      title = '🛡️ Top Defenders';
      color = COLORS.call.defense;
      body  = renderList(topDefenders(), r => `${nameFor(r)} — **${r.responses}** responses`);
      break;
    }
    case 'scouts': {
      title = '👀 Top Scouts';
      color = COLORS.call.scout;
      body  = renderList(topScouts(), r => `${nameFor(r)} — **${r.reports}** reports`);
      break;
    }
    case 'requesters': {
      title = '📋 Most Active Requesters';
      color = COLORS.brand.primary;
      body  = renderList(topRequesters(), r => `${nameFor(r)} — **${r.calls_made}** calls`);
      break;
    }
    case 'pushers':
    default: {
      title = '📦 Top Resource Pushers';
      color = COLORS.brand.success;
      body  = renderList(topPushSenders(), r => `${nameFor(r)} — **${formatAmount(r.total)}** (${r.pushes} pushes)`);
      break;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(body)
    .setFooter({ text: FOOTER })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
