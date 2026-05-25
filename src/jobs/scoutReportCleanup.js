import cron from 'node-cron';
import { prepare } from '../db/client.js';
import { unixNow } from '../utils/time.js';
import { logger } from '../utils/logger.js';

const DELETE_REASON = 'Scout report archived more than 24 hours ago';

function isNotFoundError(err) {
  return err?.code === 10003 || err?.status === 404;
}

function markTempChannelDeleted(callId, now) {
  prepare('UPDATE scout_reports SET temp_deleted_at = ? WHERE call_id = ?').run(now, callId);
}

export function selectDueScoutReportChannels(now) {
  return prepare(`
    SELECT *
    FROM scout_reports
    WHERE reported_at IS NOT NULL
      AND delete_after IS NOT NULL
      AND delete_after <= ?
      AND temp_deleted_at IS NULL
  `).all(now);
}

export async function cleanupDueScoutReportChannels(client, now = unixNow()) {
  const due = selectDueScoutReportChannels(now);

  for (const report of due) {
    try {
      let channel;
      try {
        channel = await client.channels.fetch(report.temp_channel_id);
      } catch (err) {
        if (isNotFoundError(err)) {
          markTempChannelDeleted(report.call_id, now);
          continue;
        }
        throw err;
      }

      if (channel?.delete) {
        try {
          await channel.delete(DELETE_REASON);
        } catch (err) {
          if (isNotFoundError(err)) {
            markTempChannelDeleted(report.call_id, now);
            continue;
          }
          throw err;
        }
      }

      markTempChannelDeleted(report.call_id, now);
    } catch (err) {
      logger.warn(`Failed to clean up scout report channel for call ${report.call_id}:`, err.message);
    }
  }
}

export function startScoutReportCleanupJob(client) {
  cron.schedule('*/10 * * * *', () => {
    cleanupDueScoutReportChannels(client)
      .catch(err => logger.warn('Scout report cleanup job failed:', err.message));
  });
  logger.info('Scout report cleanup job scheduled every 10 minutes');
}
