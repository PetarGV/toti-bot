import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import { startOrReplaceTimer } from '../../src/handlers/timer.js';
import { unixNow } from '../../src/utils/time.js';

test('startOrReplaceTimer inserts a new row with correct defaults', async () => {
  await setupTestDb();
  resetTables();

  const before = unixNow();
  startOrReplaceTimer({
    userId: 'u1', channelId: 'c1', intervalSec: 600, label: 'raid',
  });

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.channel_id, 'c1');
  assert.equal(row.interval_sec, 600);
  assert.equal(row.label, 'raid');
  assert.equal(row.fires_count, 0);
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
  assert.ok(row.next_fire_at >= before + 600 && row.next_fire_at <= before + 601);
});

test('startOrReplaceTimer replaces an existing timer and resets fires_count', async () => {
  await setupTestDb();
  resetTables();

  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 60, 100, 7, 'old', 1, 30);

  startOrReplaceTimer({
    userId: 'u1', channelId: 'c2', intervalSec: 420, label: null,
  });

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.channel_id, 'c2');
  assert.equal(row.interval_sec, 420);
  assert.equal(row.label, null);
  assert.equal(row.fires_count, 0);
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
});
