import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import { startOrReplaceTimer, handleTimerCommand } from '../../src/handlers/timer.js';
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

function makeStatusInteraction(userId) {
  const calls = [];
  return {
    user: { id: userId },
    channel: { id: 'c1' },
    options: { getSubcommand: () => 'status' },
    async reply(payload) { calls.push(payload); this.replied = true; },
    _calls: calls,
  };
}

test('/timer status shows running state with remaining time', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, now + 250, 3, 'raid', 0, null);

  const ix = makeStatusInteraction('u1');
  await handleTimerCommand(ix);

  const embed = ix._calls[0].embeds[0].toJSON();
  const stateField = embed.fields.find(f => f.name === 'State');
  assert.ok(stateField, 'State field exists');
  assert.match(stateField.value, /Running/);
});

test('/timer status shows paused state with remaining time', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, now + 9999, 3, 'raid', 1, 252);

  const ix = makeStatusInteraction('u1');
  await handleTimerCommand(ix);

  const embed = ix._calls[0].embeds[0].toJSON();
  const stateField = embed.fields.find(f => f.name === 'State');
  assert.ok(stateField, 'State field exists');
  assert.match(stateField.value, /Paused/);
  assert.match(stateField.value, /4m12s|252s/);
});
