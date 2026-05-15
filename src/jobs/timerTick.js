import cron from 'node-cron';
import { prepare } from '../db/client.js';
import { unixNow } from '../utils/time.js';
import { formatDuration } from '../utils/duration.js';
import { logger } from '../utils/logger.js';

const AUTO_DELETE_SEC = 30;

export function selectDueTimers(now) {
  return prepare('SELECT * FROM timers WHERE next_fire_at <= ? AND paused = 0').all(now);
}

async function fireDueTimers(client) {
  const now = unixNow();
  const due = selectDueTimers(now);

  for (const t of due) {
    try {
      const channel = await client.channels.fetch(t.channel_id);
      if (!channel?.isTextBased?.()) {
        logger.warn(`Timer ${t.user_id}: channel ${t.channel_id} is not text-based, skipping`);
        // Skip but advance next_fire_at to avoid infinite retry storm
        prepare('UPDATE timers SET next_fire_at = ? WHERE user_id = ?')
          .run(now + t.interval_sec, t.user_id);
        continue;
      }

      const fires = (t.fires_count ?? 0) + 1;
      const labelPart = t.label ? ` · **${t.label}**` : '';
      const content = `⏰ <@${t.user_id}>${labelPart} · run #${fires} (every ${formatDuration(t.interval_sec)})`;

      const msg = await channel.send({
        content,
        allowedMentions: { users: [t.user_id] },
      });

      // Schedule auto-delete via DB so it survives restarts.
      prepare(
        'INSERT OR REPLACE INTO pending_message_deletes (channel_id, message_id, delete_at) VALUES (?, ?, ?)'
      ).run(channel.id, msg.id, now + AUTO_DELETE_SEC);

      prepare('UPDATE timers SET next_fire_at = ?, fires_count = ? WHERE user_id = ?')
        .run(now + t.interval_sec, fires, t.user_id);
    } catch (err) {
      logger.warn(`Timer tick failed for ${t.user_id}:`, err.message);
      // Advance anyway so we don't hammer a broken channel forever
      prepare('UPDATE timers SET next_fire_at = ? WHERE user_id = ?')
        .run(now + t.interval_sec, t.user_id);
    }
  }
}

async function drainPendingDeletes(client) {
  const now = unixNow();
  const due = prepare(
    'SELECT channel_id, message_id FROM pending_message_deletes WHERE delete_at <= ?'
  ).all(now);

  for (const row of due) {
    try {
      const channel = await client.channels.fetch(row.channel_id);
      if (channel?.isTextBased?.()) {
        await channel.messages.delete(row.message_id).catch(() => {});
      }
    } catch {
      // Channel gone or message already gone — fine, just drop the row.
    }
    prepare('DELETE FROM pending_message_deletes WHERE channel_id = ? AND message_id = ?')
      .run(row.channel_id, row.message_id);
  }
}

async function tickOnce(client) {
  await fireDueTimers(client);
  await drainPendingDeletes(client);
}

export function startTimerTickJob(client) {
  cron.schedule('*/10 * * * * *', () => tickOnce(client));
  logger.info('Timer tick job scheduled every 10 seconds');
}
