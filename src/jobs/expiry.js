import cron from 'node-cron';
import { prepare } from '../db/client.js';
import { refreshCall } from '../handlers/calls.js';
import { unixNow } from '../utils/time.js';
import { logger } from '../utils/logger.js';

export async function expireCall(client, callId) {
  prepare("UPDATE calls SET status = 'expired' WHERE id = ? AND status = 'open'").run(callId);
  await refreshCall(client, callId);
}

async function expireDueCalls(client) {
  const now = unixNow();
  const due = prepare(
    "SELECT id FROM calls WHERE status = 'open' AND deadline IS NOT NULL AND deadline < ?"
  ).all(now);

  for (const row of due) {
    try {
      await expireCall(client, row.id);
    } catch (err) {
      logger.warn(`Failed to expire call ${row.id}:`, err.message);
    }
  }
}

export function startExpiryJob(client) {
  cron.schedule('*/5 * * * *', () => expireDueCalls(client));
  logger.info('Expiry job scheduled every 5 minutes');
}