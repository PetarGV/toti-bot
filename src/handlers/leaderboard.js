import { EmbedBuilder } from 'discord.js';
import { prepare } from '../db/client.js';
import { formatAmount } from '../utils/resources.js';
import { COLORS, FOOTER } from '../utils/i18n.js';

const MEDALS = ['🥇', '🥈', '🥉'];

function rankedLine(i, line) {
  const prefix = MEDALS[i] ?? `**${i + 1}.**`;
  return `${prefix} ${line}`;
}

function topPushSenders() {
  // Sum of pledged resources across all push:* calls
  return prepare(`
    SELECT pledges.user_id, SUM(CAST(pledges.amount AS INTEGER)) AS total, COUNT(*) AS pushes
    FROM pledges
    JOIN calls ON calls.id = pledges.call_id
    WHERE calls.type LIKE 'push:%'
    GROUP BY pledges.user_id
    ORDER BY total DESC
    LIMIT 10
  `).all();
}

function topDefenders() {
  // Count of pledges on combat calls (defense/reinforce/urgent)
  return prepare(`
    SELECT pledges.user_id, COUNT(*) AS responses
    FROM pledges
    JOIN calls ON calls.id = pledges.call_id
    WHERE calls.type IN ('defense', 'reinforce', 'urgent')
    GROUP BY pledges.user_id
    ORDER BY responses DESC
    LIMIT 10
  `).all();
}

function topScouts() {
  return prepare(`
    SELECT pledges.user_id, COUNT(*) AS reports
    FROM pledges
    JOIN calls ON calls.id = pledges.call_id
    WHERE calls.type = 'scout' AND pledges.amount IS NOT NULL AND pledges.amount != 'On it'
    GROUP BY pledges.user_id
    ORDER BY reports DESC
    LIMIT 10
  `).all();
}

function topRequesters() {
  return prepare(`
    SELECT author_id AS user_id, COUNT(*) AS calls_made
    FROM calls
    GROUP BY author_id
    ORDER BY calls_made DESC
    LIMIT 10
  `).all();
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
      body  = renderList(topDefenders(), r => `<@${r.user_id}> — **${r.responses}** responses`);
      break;
    }
    case 'scouts': {
      title = '👀 Top Scouts';
      color = COLORS.call.scout;
      body  = renderList(topScouts(), r => `<@${r.user_id}> — **${r.reports}** reports`);
      break;
    }
    case 'requesters': {
      title = '📋 Most Active Requesters';
      color = COLORS.brand.primary;
      body  = renderList(topRequesters(), r => `<@${r.user_id}> — **${r.calls_made}** calls`);
      break;
    }
    case 'pushers':
    default: {
      title = '📦 Top Resource Pushers';
      color = COLORS.brand.success;
      body  = renderList(topPushSenders(), r => `<@${r.user_id}> — **${formatAmount(r.total)}** (${r.pushes} pushes)`);
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