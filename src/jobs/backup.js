import cron from 'node-cron';
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { getDb, flushDb } from '../db/client.js';
import { getPrimaryGuild, getNotificationsChannel } from '../utils/guild.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/travian.db');
const BACKUP_DIR = process.env.BACKUP_DIR || join(__dirname, '../../data/backups');
const RETAIN_DAYS = parseInt(process.env.BACKUP_RETAIN_DAYS || '7', 10);

export function backupNow() {
  if (!existsSync(DB_PATH)) {
    logger.warn('Backup skipped: DB file does not exist yet');
    return null;
  }
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  // Snapshot from in-memory state, not the live file. Avoids races with the
  // debounced persist writer that could otherwise produce a torn copy.
  flushDb();
  const snapshot = getDb().export();

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  let dest = join(BACKUP_DIR, `travian-${date}.db`);
  // If a backup already exists today (e.g. manual + scheduled on same day),
  // append HHMMSS so we don't overwrite it silently.
  if (existsSync(dest)) {
    const stamp = now.toISOString().slice(11, 19).replace(/:/g, '');
    dest = join(BACKUP_DIR, `travian-${date}-${stamp}.db`);
  }
  writeFileSync(dest, Buffer.from(snapshot));
  pruneOld();
  logger.info(`Backup written: ${dest}`);
  return dest;
}

function pruneOld() {
  try {
    const cutoff = Date.now() - RETAIN_DAYS * 86400_000;
    for (const f of readdirSync(BACKUP_DIR)) {
      if (!f.startsWith('travian-') || !f.endsWith('.db')) continue;
      const p = join(BACKUP_DIR, f);
      if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
    }
  } catch (err) {
    logger.warn('Backup prune failed:', err.message);
  }
}

export function startBackupJob(client) {
  const hour = process.env.BACKUP_HOUR || '3';
  const schedule = `0 ${hour} * * *`;
  cron.schedule(schedule, async () => {
    try {
      backupNow();
    } catch (err) {
      logger.error('Backup failed:', err);
      if (client) {
        try {
          const ch = getNotificationsChannel(getPrimaryGuild(client));
          if (ch) await ch.send(`⚠️ **Backup failed:** ${err.message}`);
        } catch (notifErr) {
          logger.warn('backup: failed to send failure notification:', notifErr.message);
        }
      }
    }
  });
  logger.info(`Backup job scheduled at ${schedule}`);
}
