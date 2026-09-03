import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import {
  fetchPushReportPage,
  renderPushReportLine,
  buildPushReportPayload,
  buildPushReportDetailPayload,
  handlePushReportPage,
  handlePushReportSelect,
  handlePushReportBack,
} from '../src/handlers/pushReport.js';

function makeCall({ type = 'push:lumber', author_id = '1', x = 0, y = 0, status = 'open', amount = 1000, message_id = null, channel_id = null }) {
  const payload = JSON.stringify({ resource: type.split(':')[1], amount });
  const { lastInsertRowid } = prepare(`
    INSERT INTO calls (type, author_id, x, y, status, payload, message_id, channel_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, author_id, x, y, status, payload, message_id, channel_id);
  return lastInsertRowid;
}

function pledge(callId, userId, amount) {
  prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)').run(callId, userId, String(amount));
}

function seedVillage(x, y, player, alliance = null) {
  prepare('INSERT INTO x_world (id, x, y, player, alliance) VALUES (?, ?, ?, ?, ?)')
    .run(x * 10000 + y, x, y, player, alliance);
}

test('fetchPushReportPage: includes pushes of every status, newest first (id tiebreak)', async () => {
  await setupTestDb();
  resetTables();
  const c1 = makeCall({ status: 'open' });
  const c2 = makeCall({ status: 'filled' });
  const c3 = makeCall({ status: 'closed' });
  const c4 = makeCall({ status: 'expired' });

  const { rows, total } = fetchPushReportPage({});
  assert.equal(total, 4);
  assert.deepEqual(rows.map(r => r.id), [c4, c3, c2, c1]);
});

test('fetchPushReportPage: excludes non-push call types', async () => {
  await setupTestDb();
  resetTables();
  makeCall({ type: 'push:iron' });
  prepare(`
    INSERT INTO calls (type, author_id, x, y, status, payload)
    VALUES ('scout', '1', 0, 0, 'open', '{}')
  `).run();

  const { rows, total } = fetchPushReportPage({});
  assert.equal(total, 1);
  assert.equal(rows[0].type, 'push:iron');
});

test('fetchPushReportPage: page size is 5', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 12; i++) makeCall({});

  const page1 = fetchPushReportPage({ offset: 0 });
  const page3 = fetchPushReportPage({ offset: 10 });
  assert.equal(page1.rows.length, 5);
  assert.equal(page3.rows.length, 2);
  assert.equal(page1.total, 12);
});

test('renderPushReportLine: lists every sender one per line, amount desc', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({ type: 'push:crop', x: 5, y: -5, amount: 10000 });
  pledge(callId, 'a', 1000);
  pledge(callId, 'b', 5000);
  pledge(callId, 'c', 3000);
  pledge(callId, 'd', 9000);

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'guild1');

  assert.match(line, /🌾 \*\*Crop\*\*/);
  assert.match(line, /\(5\|-5\)/);
  assert.match(line, /4 senders/);
  const bullets = line.split('\n').filter(l => l.trim().startsWith('•'));
  assert.equal(bullets.length, 4);
  assert.match(bullets[0], /<@d> 9,000/); // highest first
  assert.match(bullets[3], /<@a> 1,000/); // lowest last
});

test('renderPushReportLine: shows the destination village owner (and alliance) from x_world', async () => {
  await setupTestDb();
  resetTables();
  seedVillage(5, -5, 'EnemyPlayer', 'ABC');
  const callId = makeCall({ x: 5, y: -5 });
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'g1');
  assert.match(line, /\(5\|-5\) — EnemyPlayer \[ABC\]/);
});

test('renderPushReportLine: no pledges yet shows "*no senders*" on its own line', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({});
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'guild1');
  assert.match(line, /0 senders/);
  assert.ok(line.split('\n').some(l => l.trim() === '*no senders*'));
});

test('renderPushReportLine: push:all target is amount * 4', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({ type: 'push:all', amount: 2000 });
  pledge(callId, 'a', 3000);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'g1');
  assert.match(line, /3,000\/8,000/);
});

test('buildPushReportPayload: empty state has no select menu, only Prev/Next', async () => {
  await setupTestDb();
  resetTables();
  const payload = buildPushReportPayload({});
  assert.match(payload.embeds[0].toJSON().description, /No resource pushes found/);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].toJSON().components[0].type, 2); // button, not select
});

test('buildPushReportPayload: non-empty page has a select row with one option per push, newest first', async () => {
  await setupTestDb();
  resetTables();
  const c1 = makeCall({ type: 'push:lumber' });
  const c2 = makeCall({ type: 'push:iron' });

  const payload = buildPushReportPayload({ offset: 0 });
  const selectRow = payload.components[0].toJSON();
  const options = selectRow.components[0].options;
  assert.equal(options.length, 2);
  assert.equal(options[0].value, String(c2)); // newest first
  assert.equal(options[1].value, String(c1));
  assert.match(options[0].label, /Iron/);
});

test('buildPushReportPayload: select customId carries the current offset', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 8; i++) makeCall({});

  const payload = buildPushReportPayload({ offset: 5 });
  const selectRow = payload.components[0].toJSON();
  assert.equal(selectRow.components[0].custom_id, 'report:pushes:select:5');
});

test('buildPushReportPayload: Previous disabled on first page, Next disabled on last page', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 12; i++) makeCall({});

  const page1 = buildPushReportPayload({ offset: 0 }).components[1].toJSON();
  assert.equal(page1.components[0].disabled, true);
  assert.equal(page1.components[1].disabled, false);

  const page3 = buildPushReportPayload({ offset: 10 }).components[1].toJSON();
  assert.equal(page3.components[0].disabled, false);
  assert.equal(page3.components[1].disabled, true);
});

test('buildPushReportDetailPayload: reuses buildPushEmbed and adds Map + Back buttons', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({ x: 3, y: 4 });
  pledge(callId, 'a', 500);

  const payload = buildPushReportDetailPayload(callId, 5);
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.title, /Resource Push/); // buildPushEmbed's own title
  assert.match(embed.fields.find(f => f.name === 'Senders').value, /<@a>/);

  const row = payload.components[0].toJSON();
  assert.equal(row.components[0].label, 'Map');
  assert.equal(row.components[1].custom_id, 'report:pushes:back:5');
});

test('buildPushReportDetailPayload: missing call is handled gracefully', async () => {
  await setupTestDb();
  resetTables();
  const payload = buildPushReportDetailPayload(999999, 0);
  assert.match(payload.embeds[0].toJSON().description, /not found/);
  assert.deepEqual(payload.components, []);
});

test('handlePushReportPage: parses offset out of the customId and updates the interaction', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 8; i++) makeCall({});

  let updated = null;
  const interaction = {
    customId: 'report:pushes:page:5',
    guildId: 'g1',
    update: async (p) => { updated = p; },
  };
  await handlePushReportPage(interaction);
  assert.match(updated.embeds[0].toJSON().title, /page 2\/2/);
});

test('handlePushReportSelect: parses offset + selected call id and shows the drill-down', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({ x: 1, y: 2 });

  let updated = null;
  const interaction = {
    customId: 'report:pushes:select:5',
    values: [String(callId)],
    update: async (p) => { updated = p; },
  };
  await handlePushReportSelect(interaction);
  assert.match(updated.embeds[0].toJSON().title, /Resource Push/);
  assert.equal(updated.components[0].toJSON().components[1].custom_id, 'report:pushes:back:5');
});

test('handlePushReportBack: returns to the list at the encoded offset', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 8; i++) makeCall({});

  let updated = null;
  const interaction = {
    customId: 'report:pushes:back:5',
    guildId: 'g1',
    update: async (p) => { updated = p; },
  };
  await handlePushReportBack(interaction);
  assert.match(updated.embeds[0].toJSON().title, /page 2\/2/);
});
