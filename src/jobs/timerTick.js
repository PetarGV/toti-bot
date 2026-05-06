import cron from 'node-cron';
import { prepare } from '../db/client.js';
import { unixNow } from '../utils/time.js';
import { formatDuration } from '../utils/duration.js';
import { logger } from '../utils/logger.js';

const AUTO_DELETE_MS = 30_000;

async function tickOnce(client) {
  const now = unixNow();
  const due = prepare('SELECT * FROM timers WHERE next_fire_at <= ?').all(now);

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

      // Auto-delete after 30s — user keeps the ping notification
      setTimeout(() => {
        msg.delete().catch(() => {});
      }, AUTO_DELETE_MS);

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

export function startTimerTickJob(client) {
  cron.schedule('*/10 * * * * *', () => tickOnce(client));
  logger.info('Timer tick job scheduled every 10 seconds');
}