import { EmbedBuilder } from 'discord.js';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { setConfig, getConfig, exec, prepare, flushDb } from '../db/client.js';
import { deployPanel } from '../panel/deploy.js';
import { fetchMap } from '../jobs/mapFetch.js';
import { backupNow } from '../jobs/backup.js';
import { discordTimestamp } from '../utils/time.js';
import { snapshot } from '../utils/metrics.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH  = process.env.DB_PATH || join(__dirname, '../../data/travian.db');
const LOG_DIR  = process.env.LOG_DIR || join(__dirname, '../../data/logs');
const SECRET_RE = /(token|password|secret|api[_-]?key)/i;

export async function handleSetup(interaction) {
  const type = interaction.options.getString('type');
  await deployPanel(interaction, type);
}

export async function handleAdmin(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'set-server') {
    const url = interaction.options.getString('url').replace(/\/$/, '');
    setConfig('server_url', url);
    return interaction.reply({ content: `✅ Server URL updated to \`${url}\``, ephemeral: true });
  }

  if (sub === 'reset-round') {
    await interaction.deferReply({ ephemeral: true });
    exec('DELETE FROM x_world');
    exec('DELETE FROM pledges');
    exec('DELETE FROM calls');
    logger.info('Round reset by', interaction.user.tag);
    return interaction.editReply({ content: '✅ Round data cleared. User profiles preserved.' });
  }

  if (sub === 'fetch-map') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const count = await fetchMap();
      return interaction.editReply({ content: `✅ Map fetched — ${count} villages loaded.` });
    } catch (err) {
      logger.error('Manual map fetch failed:', err.message);
      if (err.message === 'PRE_LAUNCH') {
        return interaction.editReply({ content: '📡 Map not yet available — server may be pre-launch.' });
      }
      if (err.message === 'EMPTY_RESPONSE') {
        return interaction.editReply({ content: '⚠️ Server returned empty/invalid map data. Existing data preserved.' });
      }
      return interaction.editReply({ content: `❌ Fetch failed: ${err.message}` });
    }
  }

  if (sub === 'map-status') {
    const countRow = prepare('SELECT COUNT(*) as c FROM x_world').get();
    const total = countRow?.c ?? 0;

    if (total === 0) {
      return interaction.reply({ content: 'No map data loaded yet.', ephemeral: true });
    }

    const serverUrl = getConfig('server_url') || process.env.TRAVIAN_SERVER_URL || '*not set*';
    const lastFetchAt = parseInt(getConfig('last_fetch_at') || '0', 10);
    const lastFetchCount = parseInt(getConfig('last_fetch_count') || '0', 10);

    const topAlliances = prepare(`
      SELECT alliance, COUNT(*) as c FROM x_world
      WHERE alliance IS NOT NULL AND alliance != ''
      GROUP BY alliance ORDER BY c DESC LIMIT 5
    `).all();

    const allianceList = topAlliances.length
      ? topAlliances.map((a, i) => `${i + 1}. **${a.alliance}** — ${a.c} villages`).join('\n')
      : '*No alliances found*';

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('🗺️ Map Data Status')
      .addFields(
        { name: 'Server',          value: serverUrl,                                          inline: false },
        { name: 'Last Fetch',      value: lastFetchAt ? discordTimestamp(lastFetchAt) : '*never*', inline: true },
        { name: 'Last Fetch Rows', value: String(lastFetchCount),                             inline: true },
        { name: 'Total Villages',  value: total.toLocaleString(),                             inline: true },
        { name: 'Top Alliances',   value: allianceList,                                       inline: false },
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'diag') {
    const m = snapshot();
    const mem = process.memoryUsage();
    let dbBytes = 0;
    try { dbBytes = statSync(DB_PATH).size; } catch {}

    const openCalls = prepare("SELECT COUNT(*) c FROM calls WHERE status = 'open'").get()?.c ?? 0;
    const totalCalls = prepare('SELECT COUNT(*) c FROM calls').get()?.c ?? 0;

    const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
    const fmtUptime = (s) => {
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m2 = Math.floor((s % 3600) / 60);
      return `${d}d ${h}h ${m2}m`;
    };

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand.info)
      .setTitle('🔧 Bot Diagnostics')
      .addFields(
        { name: 'Uptime',          value: fmtUptime(m.uptimeSec),  inline: true },
        { name: 'Memory (RSS)',    value: fmtMB(mem.rss),          inline: true },
        { name: 'Heap Used',       value: fmtMB(mem.heapUsed),     inline: true },
        { name: 'DB Size',         value: fmtMB(dbBytes),          inline: true },
        { name: 'Open Calls',      value: String(openCalls),       inline: true },
        { name: 'Total Calls',     value: String(totalCalls),      inline: true },
        { name: 'Map Fetches',     value: String(m.mapFetches),    inline: true },
        { name: 'Map Errors',      value: String(m.mapFetchErrors),inline: true },
        { name: 'Last Error',      value: m.lastErrorMessage ? `${m.lastErrorMessage.slice(0, 100)}\n*${discordTimestamp(Math.floor(m.lastErrorAt/1000), 'R')}*` : '*none*', inline: false },
        { name: 'Node Version',    value: process.version,         inline: true },
      )
      .setFooter({ text: FOOTER })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'tail-log') {
    const requested = interaction.options.getInteger('lines') ?? 50;
    const n = Math.min(Math.max(requested, 1), 200);
    const path = join(LOG_DIR, 'bot.log');
    if (!existsSync(path)) {
      return interaction.reply({ content: 'No log file yet.', ephemeral: true });
    }
    let text;
    try { text = readFileSync(path, 'utf8'); } catch (err) {
      return interaction.reply({ content: `❌ Could not read log: ${err.message}`, ephemeral: true });
    }
    const lines = text.split('\n').filter(Boolean).slice(-n)
      .map(l => SECRET_RE.test(l) ? '[REDACTED — line contained secret-like keyword]' : l);
    const block = lines.join('\n').slice(-1900);
    return interaction.reply({ content: `\`\`\`\n${block || '(empty)'}\n\`\`\``, ephemeral: true });
  }

  if (sub === 'db-vacuum') {
    await interaction.deferReply({ ephemeral: true });
    try {
      let beforeSize = 0;
      try { beforeSize = statSync(DB_PATH).size; } catch {}
      exec('VACUUM');
      flushDb();
      let afterSize = 0;
      try { afterSize = statSync(DB_PATH).size; } catch {}
      const fmt = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
      logger.info(`DB vacuumed by ${interaction.user.tag}: ${fmt(beforeSize)} → ${fmt(afterSize)}`);
      return interaction.editReply({ content: `✅ Vacuumed: ${fmt(beforeSize)} → ${fmt(afterSize)}` });
    } catch (err) {
      logger.error('Vacuum failed:', err);
      return interaction.editReply({ content: `❌ Vacuum failed: ${err.message}` });
    }
  }

  if (sub === 'backup-now') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const path = backupNow();
      return interaction.editReply({ content: path ? `✅ Backup written: \`${path}\`` : '⚠️ No DB to backup yet.' });
    } catch (err) {
      logger.error('Manual backup failed:', err);
      return interaction.editReply({ content: `❌ Backup failed: ${err.message}` });
    }
  }
}