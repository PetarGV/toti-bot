
  if (!hasColumn('pledges', 'inf')) {
    try { exec('ALTER TABLE pledges ADD COLUMN inf INTEGER DEFAULT 0'); }
    catch (err) { logger.warn('Migration pledges.inf skipped:', err.message); }
  }
  if (!hasColumn('pledges', 'cav')) {
    try { exec('ALTER TABLE pledges ADD COLUMN cav INTEGER DEFAULT 0'); }
    catch (err) { logger.warn('Migration pledges.cav skipped:', err.message); }
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
    exec('CREATE INDEX IF NOT EXISTS idx_reports_attacker ON incoming_reports(attacker_x, attacker_y, first_eta)');
    exec('CREATE INDEX IF NOT EXISTS idx_reports_defender ON incoming_reports(defender_x, defender_y, first_eta)');
    exec('CREATE INDEX IF NOT EXISTS idx_reports_created  ON incoming_reports(created_at)');
  } catch (err) {
    logger.warn('Migration incoming_reports table skipped:', err.message);
  }

  // Seed defense-coordination config defaults (insert-or-ignore).
  const DEFENSE_CONFIG_DEFAULTS = {
    threat_chief_min_waves: '4',
    threat_chief_timing_sec: '30',
    threat_focus_window_hrs: '6',
    threat_scatter_radius: '5',
    threat_real_min_waves: '2',
    inbetween_min_gap_sec: '1',
  };
  for (const [key, value] of Object.entries(DEFENSE_CONFIG_DEFAULTS)) {
    try { prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)').run(key, value); }
    catch (err) { logger.warn(`Migration config seed ${key} skipped:`, err.message); }
  }

  // One-shot: rename existing 'defense' panels and open defense calls.
  try {
    const flag = prepare('SELECT value FROM config WHERE key=?').get('migrated_defense_to_def_calls');
    if (!flag) {
      exec("UPDATE panels SET type='def-calls' WHERE type='defense'");
      exec("UPDATE calls  SET type='def_active' WHERE type='defense' AND status='open'");
      prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('migrated_defense_to_def_calls', 'true');
    }
  } catch (err) {
    logger.warn('Migration defense → def-calls skipped:', err.message);
  }
}
