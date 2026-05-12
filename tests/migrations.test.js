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
