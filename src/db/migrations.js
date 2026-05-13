import { prepare, exec } from './client.js';
import { logger } from '../utils/logger.js';
import { normalizeIgn } from '../utils/ign.js';

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

  try {
    exec(`
      CREATE TABLE IF NOT EXISTS sync_exclusions (
        discord_id TEXT PRIMARY KEY,
        added_at   INTEGER DEFAULT (unixepoch())
      )
    `);
  } catch (err) {
    logger.warn('Migration sync_exclusions table skipped:', err.message);
  }

  if (!hasColumn('users', 'onboarding_channel_id')) {
    try {
      exec('ALTER TABLE users ADD COLUMN onboarding_channel_id TEXT');
    } catch (err) {
      logger.warn('Migration users.onboarding_channel_id skipped:', err.message);
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
    exec(`
      CREATE TABLE IF NOT EXISTS pending_message_deletes (
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        delete_at  INTEGER NOT NULL,
        PRIMARY KEY (channel_id, message_id)
      )
    `);
  } catch (err) {
    logger.warn('Migration pending_message_deletes table skipped:', err.message);
  }

  try {
    exec("UPDATE panels SET type='scout' WHERE type='intel'");
  } catch (err) {
    logger.warn("Migration panels.type intel→scout skipped:", err.message);
  }

  // Many-to-many Discord ↔ IGN: create new tables + move legacy columns.
  try {
    exec(`
      CREATE TABLE IF NOT EXISTS travian_accounts (
        ign            TEXT PRIMARY KEY,
        normalized_ign TEXT NOT NULL UNIQUE,
        home_x         INTEGER,
        home_y         INTEGER,
        tribe          INTEGER,
        created_at     INTEGER DEFAULT (unixepoch())
      )
    `);
    exec(`
      CREATE TABLE IF NOT EXISTS user_ign_links (
        discord_id  TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
        ign         TEXT NOT NULL REFERENCES travian_accounts(ign) ON DELETE CASCADE,
        is_primary  INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL,
        created_at  INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (discord_id, ign)
      )
    `);
    exec(`CREATE INDEX IF NOT EXISTS idx_links_ign ON user_ign_links(ign)`);
    exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_links_one_primary ON user_ign_links(discord_id) WHERE is_primary = 1`);
  } catch (err) {
    logger.warn('Migration: link tables create skipped:', err.message);
  }

  if (hasColumn('users', 'ign')) {
    try {
      const legacy = prepare(`
        SELECT discord_id, ign, home_x, home_y, tribe
        FROM users
        WHERE ign IS NOT NULL AND ign != ''
      `).all();

      const insertAcct = prepare(`
        INSERT OR IGNORE INTO travian_accounts (ign, normalized_ign, home_x, home_y, tribe)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertLink = prepare(`
        INSERT OR IGNORE INTO user_ign_links (discord_id, ign, is_primary, source)
        VALUES (?, ?, 1, 'self')
      `);

      for (const row of legacy) {
        const norm = normalizeIgn(row.ign);
        if (!norm) continue;
        const canonical = prepare(`
          SELECT player FROM x_world
          WHERE player IS NOT NULL AND lower(player) = lower(?)
          LIMIT 1
        `).get(row.ign);
        const ign = canonical?.player ?? row.ign;
        insertAcct.run(ign, norm, row.home_x ?? null, row.home_y ?? null, row.tribe ?? null);
        insertLink.run(row.discord_id, ign);
      }

      exec('ALTER TABLE users DROP COLUMN ign');
      exec('ALTER TABLE users DROP COLUMN home_x');
      exec('ALTER TABLE users DROP COLUMN home_y');
      exec('ALTER TABLE users DROP COLUMN tribe');
    } catch (err) {
      logger.warn('Migration: users → links move skipped:', err.message);
    }
  }
}