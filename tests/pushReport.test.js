import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { fetchPushReportPage, renderPushReportLine, buildPushReportPayload, handlePushReportPage } from '../src/handlers/pushReport.js';

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

test('fetchPushReportPage: pagination respects offset and page size', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 15; i++) makeCall({});

  const page1 = fetchPushReportPage({ offset: 0 });
  const page2 = fetchPushReportPage({ offset: 10 });
  assert.equal(page1.rows.length, 10);
  assert.equal(page2.rows.length, 5);
  assert.equal(page1.total, 15);
  assert.equal(page2.total, 15);
});

test('renderPushReportLine: lists every sender ordered by amount desc, not just the top 3', async () => {
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
  const sendersLine = line.split('\n').find(l => l.includes('Senders:'));
  assert.match(sendersLine, /<@d>.*<@b>.*<@c>.*<@a>/s); // all 4, amount desc
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

test('renderPushReportLine: no x_world match omits the owner suffix', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({ x: 99, y: 99 });
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'g1');
  assert.match(line, /\(99\|99\) — /); // status badge follows, no owner text before it
  assert.ok(!line.includes('EnemyPlayer'));
});

test('renderPushReportLine: no pledges yet shows "*no senders*" and 0 senders', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({});
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'guild1');
  assert.match(line, /0 senders/);
  assert.match(line, /Senders: \*no senders\*/);
});

test('renderPushReportLine: includes a Jump link only when message_id/channel_id are set', async () => {
  await setupTestDb();
  resetTables();
  const withMsg = makeCall({ message_id: '999', channel_id: '888' });
  const withoutMsg = makeCall({});

  const callA = prepare('SELECT * FROM calls WHERE id = ?').get(withMsg);
  const callB = prepare('SELECT * FROM calls WHERE id = ?').get(withoutMsg);

  assert.match(renderPushReportLine(callA, 'g1'), /\[Jump\]\(https:\/\/discord\.com\/channels\/g1\/888\/999\)/);
  assert.ok(!renderPushReportLine(callB, 'g1').includes('[Jump]'));
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

test('buildPushReportPayload: empty state shows "No resource pushes found"', async () => {
  await setupTestDb();
  resetTables();
  const payload = buildPushReportPayload({});
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /No resource pushes found/);
  assert.match(embed.footer.text, /^0 pushes total$/);
});

test('buildPushReportPayload: Previous disabled on first page, Next disabled on last page', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 15; i++) makeCall({});

  const page1 = buildPushReportPayload({ offset: 0 }).components[0].toJSON();
  assert.equal(page1.components[0].disabled, true);  // Previous
  assert.equal(page1.components[1].disabled, false); // Next

  const page2 = buildPushReportPayload({ offset: 10 }).components[0].toJSON();
  assert.equal(page2.components[0].disabled, false); // Previous
  assert.equal(page2.components[1].disabled, true);  // Next
});

test('buildPushReportPayload: pagination customId carries only the offset, no filter', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 15; i++) makeCall({});

  const payload = buildPushReportPayload({ offset: 0 }).components[0].toJSON();
  assert.equal(payload.components[1].custom_id, 'admin:push-report:page:10');
});

test('handlePushReportPage: parses offset out of the customId and updates the interaction', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 12; i++) makeCall({});

  let updated = null;
  const interaction = {
    customId: 'admin:push-report:page:10',
    guildId: 'g1',
    update: async (p) => { updated = p; },
  };
  await handlePushReportPage(interaction);
  assert.ok(updated);
  const embed = updated.embeds[0].toJSON();
  assert.match(embed.title, /page 2\/2/);
});
