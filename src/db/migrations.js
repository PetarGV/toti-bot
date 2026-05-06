import { prepare, exec } from './client.js';
import { logger } from '../utils/logger.js';

function hasColumn(table, column) {
  const cols = prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

export function runMigrations() {
  if (!hasColumn('users', 'tribe')) {
    try {
      exec('ALTER TABLE users ADD COLUMN tribe INTEGER');
    } catch (err) {
      logger.warn('Migration users.tribe skipped:', err.message);
    }
  }

  if (!hasColumn('users', 'notify_pledges')) {
    try {
      exec('ALTER TABLE users ADD COLUMN notify_pledges INTEGER DEFAULT 0');
    } catch (err) {
      logger.warn('Migration users.notify_pledges skipped:', err.message);
    }
  }

  if (!hasColumn('panels', 'restore_failed_at')) {
    try {
      exec('ALTER TABLE panels ADD COLUMN restore_failed_at INTEGER');
    } catch (err) {
      logger.warn('Migration panels.restore_failed_at skipped:', err.message);
    }
  }

  try {
    exec(`
      CREATE TABLE IF NOT EXISTS timers (
        user_id      TEXT PRIMARY KEY,
        channel_id   TEXT NOT NULL,
        interval_sec INTEGER NOT NULL,
        next_fire_at INTEGER NOT NULL,
        fires_count  INTEGER DEFAULT 0,
        label        TEXT,
        created_at   INTEGER DEFAULT (unixepoch())
      )
    `);
  } catch (err) {
    logger.warn('Migration timers table skipped:', err.message);
  }

  try {
    exec("UPDATE panels SET type='scout' WHERE type='intel'");
  } catch (err) {
    logger.warn("Migration panels.type intel→scout skipped:", err.message);
  }
}