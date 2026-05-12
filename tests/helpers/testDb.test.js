import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './testDb.js';
import { prepare } from '../../src/db/client.js';

test('setupTestDb initialises an empty DB and resetTables clears users/x_world', async () => {
  await setupTestDb();

  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  prepare('INSERT INTO x_world (id, x, y, player) VALUES (?, ?, ?, ?)').run(1, 0, 0, 'Test');
  resetTables();

  const usersCount = prepare('SELECT COUNT(*) as c FROM users').get()?.c ?? 0;
  const xworldCount = prepare('SELECT COUNT(*) as c FROM x_world').get()?.c ?? 0;
  assert.equal(usersCount, 0);
  assert.equal(xworldCount, 0);
});
