import { prepare, exec } from '../db/client.js';
import { buildPanel, PANEL_TYPES } from './types.js';
import { logger } from '../utils/logger.js';

export async function deployPanel(interaction, type) {
  if (!PANEL_TYPES.includes(type)) {
    return interaction.reply({
      content: `Unknown panel type. Choose: ${PANEL_TYPES.join(', ')}`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.channel;

  // Delete old panel message if it exists
  const existing = prepare('SELECT message_id FROM panels WHERE channel_id = ?').get(channel.id);
  if (existing) {
    try {
      const old = await channel.messages.fetch(existing.message_id);
      await old.delete();
    } catch {
      // Message already gone — fine
    }
  }

  const payload = buildPanel(type);
  const msg = await channel.send(payload);

  try {
    await msg.pin();
  } catch (err) {
    logger.warn('Could not pin panel message:', err.message);
  }

  prepare(`
    INSERT OR REPLACE INTO panels (channel_id, type, message_id)
    VALUES (?, ?, ?)
  `).run(channel.id, type, msg.id);

  await interaction.editReply({ content: `✅ ${type} panel deployed and pinned.` });
  logger.info(`Panel [${type}] deployed in #${channel.name} (${channel.id})`);
}

export async function restorePanels(client) {
  const panels = prepare('SELECT * FROM panels').all();
  const now = Math.floor(Date.now() / 1000);

  for (const row of panels) {
    if (row.restore_failed_at && (now - row.restore_failed_at) < 86400) {
      continue;
    }

    try {
      const channel = await client.channels.fetch(row.channel_id);
      const msg = await channel.messages.fetch(row.message_id);
      const payload = buildPanel(row.type);
      await msg.edit(payload);
      prepare('UPDATE panels SET restore_failed_at = NULL WHERE channel_id = ?').run(row.channel_id);
      logger.info(`Panel [${row.type}] restored in #${channel.name}`);
    } catch (err) {
      logger.warn(`Could not restore panel for channel ${row.channel_id}:`, err.message);
      prepare('UPDATE panels SET restore_failed_at = ? WHERE channel_id = ?').run(now, row.channel_id);
    }
  }
}
