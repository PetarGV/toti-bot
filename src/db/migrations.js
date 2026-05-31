import { prepare, exec } from './client.js';
import { logger } from '../utils/logger.js';
import { normalizeIgn } from '../utils/ign.js';

function hasColumn(table, column) {
  const cols = prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

export function runMigrations() {
  if (!hasColumn("users", "tribe")) {
    try {
      exec("ALTER TABLE users ADD COLUMN tribe INTEGER");
    } catch (err) {
      logger.warn("Migration users.tribe skipped:", err.message);
    }
  }

  if (!hasColumn("users", "notify_pledges")) {
    try {
      exec("ALTER TABLE users ADD COLUMN notify_pledges INTEGER DEFAULT 0");
    } catch (err) {
      logger.warn("Migration users.notify_pledges skipped:", err.message);
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
    logger.warn("Migration sync_exclusions table skipped:", err.message);
  }

  if (!hasColumn("users", "onboarding_channel_id")) {
    try {
      exec("ALTER TABLE users ADD COLUMN onboarding_channel_id TEXT");
    } catch (err) {
      logger.warn(
        "Migration users.onboarding_channel_id skipped:",
        err.message,
      );
    }
  }

  if (!hasColumn("panels", "restore_failed_at")) {
    try {
      exec("ALTER TABLE panels ADD COLUMN restore_failed_at INTEGER");
    } catch (err) {
      logger.warn("Migration panels.restore_failed_at skipped:", err.message);
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
    logger.warn("Migration timers table skipped:", err.message);
  }

  if (!hasColumn("timers", "paused")) {
    try {
      exec("ALTER TABLE timers ADD COLUMN paused INTEGER DEFAULT 0");
    } catch (err) {
      logger.warn("Migration timers.paused skipped:", err.message);
    }
  }

  if (!hasColumn("timers", "remaining_sec")) {
    try {
      exec("ALTER TABLE timers ADD COLUMN remaining_sec INTEGER");
    } catch (err) {
      logger.warn("Migration timers.remaining_sec skipped:", err.message);
    }
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
    logger.warn(
      "Migration pending_message_deletes table skipped:",
      err.message,
    );
  }

  try {
    exec(`
      CREATE TABLE IF NOT EXISTS scout_reports (
        call_id             INTEGER PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
        scout_code          TEXT NOT NULL,
        temp_channel_id     TEXT NOT NULL,
        archive_channel_id  TEXT,
        archive_message_id  TEXT,
        reporter_id         TEXT,
        report_note         TEXT,
        screenshot_url      TEXT,
        reported_at         INTEGER,
        delete_after        INTEGER,
        temp_deleted_at     INTEGER,
        created_at          INTEGER DEFAULT (unixepoch())
      )
    `);
  } catch (err) {
    logger.warn("Migration scout_reports table skipped:", err.message);
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
    exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_links_one_primary ON user_ign_links(discord_id) WHERE is_primary = 1`,
    );
  } catch (err) {
    logger.warn("Migration: link tables create skipped:", err.message);
  }

  if (hasColumn("users", "ign")) {
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
        insertAcct.run(
          ign,
          norm,
          row.home_x ?? null,
          row.home_y ?? null,
          row.tribe ?? null,
        );
        insertLink.run(row.discord_id, ign);
      }

      exec("ALTER TABLE users DROP COLUMN ign");
      exec("ALTER TABLE users DROP COLUMN home_x");
      exec("ALTER TABLE users DROP COLUMN home_y");
      exec("ALTER TABLE users DROP COLUMN tribe");
    } catch (err) {
      logger.warn("Migration: users → links move skipped:", err.message);
    }
  }

  if (!hasColumn("pledges", "inf")) {
    try {
      exec("ALTER TABLE pledges ADD COLUMN inf INTEGER DEFAULT 0");
    } catch (err) {
      logger.warn("Migration pledges.inf skipped:", err.message);
    }
  }
  if (!hasColumn("pledges", "cav")) {
    try {
      exec("ALTER TABLE pledges ADD COLUMN cav INTEGER DEFAULT 0");
    } catch (err) {
      logger.warn("Migration pledges.cav skipped:", err.message);
    }
  }

  try {
    exec(`
      CREATE TABLE IF NOT EXISTS incoming_reports (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id       TEXT NOT NULL,
        defender_x        INTEGER NOT NULL,
        defender_y        INTEGER NOT NULL,
        attacker_x        INTEGER NOT NULL,
        attacker_y        INTEGER NOT NULL,
        first_eta         INTEGER NOT NULL,
        waves             INTEGER NOT NULL,
        wave_spread_sec   INTEGER,
        notes             TEXT,
        threat_class      TEXT NOT NULL DEFAULT 'unknown',
        threat_override   TEXT,
        escalated_call_id INTEGER REFERENCES calls(id),
        status            TEXT NOT NULL DEFAULT 'open',
        reports_msg_id    TEXT,
        created_at        INTEGER DEFAULT (unixepoch())
      )
    `);
    exec(
      "CREATE INDEX IF NOT EXISTS idx_reports_attacker ON incoming_reports(attacker_x, attacker_y, first_eta)",
    );
    exec(
      "CREATE INDEX IF NOT EXISTS idx_reports_defender ON incoming_reports(defender_x, defender_y, first_eta)",
    );
    exec(
      "CREATE INDEX IF NOT EXISTS idx_reports_created  ON incoming_reports(created_at)",
    );
  } catch (err) {
    logger.warn("Migration incoming_reports table skipped:", err.message);
  }

  // Seed defense-coordination config defaults (insert-or-ignore).
  const DEFENSE_CONFIG_DEFAULTS = {
    threat_chief_min_waves: "4",
    threat_chief_timing_sec: "30",
    threat_focus_window_hrs: "6",
    threat_scatter_radius: "5",
    threat_real_min_waves: "2",
    inbetween_min_gap_sec: "1",
  };
  for (const [key, value] of Object.entries(DEFENSE_CONFIG_DEFAULTS)) {
    try {
      prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)").run(
        key,
        value,
      );
    } catch (err) {
      logger.warn(`Migration config seed ${key} skipped:`, err.message);
    }
  }

  // One-shot: rename existing 'defense' panels and open defense calls.
  try {
    const flag = prepare("SELECT value FROM config WHERE key=?").get(
      "migrated_defense_to_def_calls",
    );
    if (!flag) {
      exec("UPDATE panels SET type='def-calls' WHERE type='defense'");
      exec(
        "UPDATE calls  SET type='def_active' WHERE type='defense' AND status='open'",
      );
      prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(
        "migrated_defense_to_def_calls",
        "true",
      );
    }
  } catch (err) {
    logger.warn("Migration defense → def-calls skipped:", err.message);
  }

  // One-shot: backfill explicit channel config keys from the most recently
  // deployed panel of each operational type. Heals prod where the panels
  // table contains duplicate rows after the defense→def-calls migration.
  try {
    const flag = prepare("SELECT value FROM config WHERE key=?").get(
      "backfilled_channel_config",
    );
    if (!flag) {
      const KEYS = {
        reports: "reports_channel_id",
        "def-calls": "def_calls_channel_id",
        leadership: "leadership_channel_id",
      };
      for (const [type, key] of Object.entries(KEYS)) {
        const row = prepare(
          "SELECT channel_id FROM panels WHERE type = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        ).get(type);
        if (row?.channel_id) {
          prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(
            key,
            row.channel_id,
          );
        }
      }
      prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(
        "backfilled_channel_config",
        "true",
      );
    }
  } catch (err) {
    logger.warn("Migration: backfill channel config skipped:", err.message);
  }
}
