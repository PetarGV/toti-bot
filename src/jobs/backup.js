import cron from 'node-cron';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

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

  const stamp = new Date().toISOString().slice(0, 10);
  const dest = join(BACKUP_DIR, `travian-${stamp}.db`);
  copyFileSync(DB_PATH, dest);
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

export function startBackupJob() {
  const hour = process.env.BACKUP_HOUR || '3';
  const schedule = `0 ${hour} * * *`;
  cron.schedule(schedule, () => {
    try { backupNow(); } catch (err) { logger.error('Backup failed:', err); }
  });
  logger.info(`Backup job scheduled at ${schedule}`);
}