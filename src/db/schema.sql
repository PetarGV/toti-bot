CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  discord_id     TEXT PRIMARY KEY,
  ign            TEXT,
  home_x         INTEGER,
  home_y         INTEGER,
  role           TEXT DEFAULT 'member',
  tribe          INTEGER,
  notify_pledges INTEGER DEFAULT 0,
  created_at     INTEGER DEFAULT (unixepoch())
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
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(call_id, user_id)
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
  user_id      TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL,
  interval_sec INTEGER NOT NULL,
  next_fire_at INTEGER NOT NULL,
  fires_count  INTEGER DEFAULT 0,
  label        TEXT,
  created_at   INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_xworld_coords ON x_world(x, y);
CREATE INDEX IF NOT EXISTS idx_calls_status  ON calls(status);
CREATE INDEX IF NOT EXISTS idx_pledges_call  ON pledges(call_id);
