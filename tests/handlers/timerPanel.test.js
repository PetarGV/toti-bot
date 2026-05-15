import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import {
  handleTimerPanelPreset,
  handleTimerPanelCustomModal,
} from '../../src/handlers/timer.js';
import { unixNow } from '../../src/utils/time.js';

function makeButtonInteraction({ userId = 'u1', channelId = 'c1', customId }) {
  const calls = [];
  return {
    user: { id: userId },
    channel: { id: channelId },
    customId,
    async reply(payload) { calls.push(['reply', payload]); this.replied = true; },
    _calls: calls,
  };
}

function makeModalInteraction({ userId = 'u1', channelId = 'c1', fields = {} }) {
  const calls = [];
  return {
    user: { id: userId },
    channel: { id: channelId },
    customId: 'timer:custom_submit',
    fields: {
      getTextInputValue(name) { return fields[name] ?? ''; },
    },
    async reply(payload) { calls.push(['reply', payload]); this.replied = true; },
    _calls: calls,
  };
}

test('preset 7m starts a new timer', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeButtonInteraction({ customId: 'timer:preset:7m' });
  await handleTimerPanelPreset(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.interval_sec, 420);
  assert.equal(row.paused, 0);
  assert.equal(row.fires_count, 0);

  const [_, payload] = ix._calls[0];
  assert.equal(payload.ephemeral, true);
  assert.match(payload.content, /started|replaced/i);
});

test('preset replaces existing timer and resets fires', async () => {
  await setupTestDb();
  resetTables();

  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 60, 100, 5, 'old', 0, null);

  const ix = makeButtonInteraction({ customId: 'timer:preset:10m' });
  await handleTimerPanelPreset(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.interval_sec, 600);
  assert.equal(row.fires_count, 0);
});

test('custom modal with valid interval starts timer', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeModalInteraction({ fields: { interval: '15m', label: 'farm' } });
  await handleTimerPanelCustomModal(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.interval_sec, 900);
  assert.equal(row.label, 'farm');
});

test('custom modal with invalid interval replies with error and no DB write', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeModalInteraction({ fields: { interval: 'banana' } });
  await handleTimerPanelCustomModal(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row, undefined);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /invalid interval/i);
  assert.equal(payload.ephemeral, true);
});
