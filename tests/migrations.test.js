import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare, exec } from '../src/db/client.js';

test('migration creates travian_accounts and user_ign_links with expected columns', async () => {
  await setupTestDb();
  resetTables();

  const accountCols = prepare(`PRAGMA table_info(travian_accounts)`).all().map(c => c.name);
  const linkCols    = prepare(`PRAGMA table_info(user_ign_links)`).all().map(c => c.name);

  assert.deepEqual(
    accountCols.sort(),
    ['created_at', 'home_x', 'home_y', 'ign', 'normalized_ign', 'tribe'].sort(),
  );
  assert.deepEqual(
    linkCols.sort(),
    ['created_at', 'discord_id', 'ign', 'is_primary', 'source'].sort(),
  );
});

test('partial unique index enforces one primary per Discord user', async () => {
  await setupTestDb();
  resetTables();

  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  prepare('INSERT INTO travian_accounts (ign, normalized_ign) VALUES (?, ?)').run('Alpha', 'alpha');
  prepare('INSERT INTO travian_accounts (ign, normalized_ign) VALUES (?, ?)').run('Beta', 'beta');
  prepare(`INSERT INTO user_ign_links (discord_id, ign, is_primary, source) VALUES (?, ?, 1, 'self')`).run('111', 'Alpha');

  assert.throws(
    () => prepare(`INSERT INTO user_ign_links (discord_id, ign, is_primary, source) VALUES (?, ?, 1, 'admin')`).run('111', 'Beta'),
    /UNIQUE/i,
  );
});

test('migration moves a legacy users.ign row into the new tables', async () => {
  await setupTestDb();
  resetTables();

  prepare('INSERT INTO users (discord_id) VALUES (?)').run('222');
  const { runMigrations } = await import('../src/db/migrations.js');
  runMigrations();

  const user = prepare('SELECT * FROM users WHERE discord_id = ?').get('222');
  assert.ok(user, 'user row still exists after re-migration');
});

test('migration adds paused and remaining_sec columns to timers', async () => {
  await setupTestDb();
  resetTables();

  const cols = prepare(`PRAGMA table_info(timers)`).all();
  const byName = Object.fromEntries(cols.map(c => [c.name, c]));

  assert.ok(byName.paused,        'paused column exists');
  assert.equal(byName.paused.type, 'INTEGER');
  assert.equal(byName.paused.dflt_value, '0');

  assert.ok(byName.remaining_sec, 'remaining_sec column exists');
  assert.equal(byName.remaining_sec.type, 'INTEGER');
});

test('existing running timer rows survive migration unchanged', async () => {
  await setupTestDb();
  resetTables();

  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('user-1', 'chan-1', 600, 9_999_999_999, 0, 'raid');

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('user-1');
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
});
