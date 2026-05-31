CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  discord_id     TEXT PRIMARY KEY,
  role           TEXT DEFAULT 'member',
  notify_pledges INTEGER DEFAULT 0,
  created_at     INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS travian_accounts (
  ign            TEXT PRIMARY KEY,
  normalized_ign TEXT NOT NULL UNIQUE,
  home_x         INTEGER,
  home_y         INTEGER,
  tribe          INTEGER,
  created_at     INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS user_ign_links (
  discord_id  TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  ign         TEXT NOT NULL REFERENCES travian_accounts(ign) ON DELETE CASCADE,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL,
  created_at  INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (discord_id, ign)
);

CREATE TABLE IF NOT EXISTS panels (
  channel_id       TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  message_id       TEXT NOT NULL,
  restore_failed_at INTEGER,
  created_at       INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  deadline   INTEGER,
  message_id TEXT,
  channel_id TEXT,
  status     TEXT DEFAULT 'open',
  payload    TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS pledges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id    INTEGER NOT NULL REFERENCES calls(id),
  user_id    TEXT NOT NULL,
  amount     TEXT,
  inf        INTEGER DEFAULT 0,
  cav        INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(call_id, user_id)
);

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
);

CREATE TABLE IF NOT EXISTS x_world (
  id         INTEGER PRIMARY KEY,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  tid        INTEGER,
  vid        INTEGER,
  village    TEXT,
  uid        INTEGER,
  player     TEXT,
  aid        INTEGER,
  alliance   TEXT,
  population INTEGER,
  fetched_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS timers (
  user_id       TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL,
  interval_sec  INTEGER NOT NULL,
  next_fire_at  INTEGER NOT NULL,
  fires_count   INTEGER DEFAULT 0,
  label         TEXT,
  paused        INTEGER DEFAULT 0,
  remaining_sec INTEGER,
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_xworld_coords ON x_world(x, y);
CREATE INDEX IF NOT EXISTS idx_calls_status  ON calls(status);
CREATE INDEX IF NOT EXISTS idx_pledges_call  ON pledges(call_id);
CREATE INDEX IF NOT EXISTS idx_links_ign     ON user_ign_links(ign);
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_one_primary
  ON user_ign_links(discord_id) WHERE is_primary = 1;

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
);

CREATE INDEX IF NOT EXISTS idx_reports_attacker ON incoming_reports(attacker_x, attacker_y, first_eta);
CREATE INDEX IF NOT EXISTS idx_reports_defender ON incoming_reports(defender_x, defender_y, first_eta);
CREATE INDEX IF NOT EXISTS idx_reports_created  ON incoming_reports(created_at);
