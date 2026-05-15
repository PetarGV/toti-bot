import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import {
  handleTimerPanelPreset,
  handleTimerPanelCustomModal,
} from '../../src/handlers/timer.js';
import { handleTimerPanelPause } from '../../src/handlers/timer.js';
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

test('Pause with no timer replies "no active timer"', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /no active timer/i);
  assert.equal(payload.ephemeral, true);
});

test('Pause on a running timer captures remaining_sec', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, now + 250, 4, null, 0, null);

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.paused, 1);
  assert.ok(row.remaining_sec >= 249 && row.remaining_sec <= 250);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /paused/i);
});

test('Pause on a paused timer resumes it', async () => {
  await setupTestDb();
  resetTables();

  const before = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, before - 100, 4, null, 1, 250);

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
  assert.ok(row.next_fire_at >= before + 250 && row.next_fire_at <= before + 251);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /resumed/i);
});

test('Pause on a paused timer with 0 remaining resumes and fires immediately', async () => {
  await setupTestDb();
  resetTables();

  const before = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, before - 9999, 4, null, 1, 0);

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.paused, 0);
  assert.ok(row.next_fire_at <= before + 1);
});
