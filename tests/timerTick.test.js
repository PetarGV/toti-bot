import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { selectDueTimers } from '../src/jobs/timerTick.js';
import { unixNow } from '../src/utils/time.js';

test('selectDueTimers returns running due timers and skips paused ones', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();

  // Running, due
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u-running', 'c1', 600, now - 1, 0, null, 0, null);

  // Paused, would otherwise be due
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u-paused', 'c1', 600, now - 1, 0, null, 1, 300);

  // Running, not yet due
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u-future', 'c1', 600, now + 9999, 0, null, 0, null);

  const due = selectDueTimers(now);
  assert.equal(due.length, 1);
  assert.equal(due[0].user_id, 'u-running');
});
