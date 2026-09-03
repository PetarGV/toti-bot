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

test('fetchPushReportPage: includes pushes of every status, newest first', async () => {
  await setupTestDb();
  resetTables();
  const c1 = makeCall({ status: 'open' });
  const c2 = makeCall({ status: 'filled' });
  const c3 = makeCall({ status: 'closed' });
  const c4 = makeCall({ status: 'expired' });

  const { rows, total } = fetchPushReportPage({});
  assert.equal(total, 4);
  assert.deepEqual(rows.map(r => r.id), [c4, c3, c2, c1]); // created_at DESC (insertion order tiebreak via id)
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

test('fetchPushReportPage: requesterId filters to that author only', async () => {
  await setupTestDb();
  resetTables();
  makeCall({ author_id: '111' });
  makeCall({ author_id: '222' });
  makeCall({ author_id: '111' });

  const { rows, total } = fetchPushReportPage({ requesterId: '111' });
  assert.equal(total, 2);
  assert.ok(rows.every(r => r.author_id === '111'));
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

test('renderPushReportLine: shows top 3 senders ordered by amount desc, not insertion order', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({ type: 'push:crop', x: 5, y: -5, amount: 10000 });
  pledge(callId, 'a', 1000);
  pledge(callId, 'b', 5000);
  pledge(callId, 'c', 3000);
  pledge(callId, 'd', 9000); // 4th pledge, should be excluded from top-3 but counted

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'guild1');

  assert.match(line, /🌾 \*\*Crop\*\*/);
  assert.match(line, /\(5\|-5\)/);
  assert.match(line, /4 senders/);
  // Order: d (9000), b (5000), c (3000) — a (1000) excluded from top 3
  const topLine = line.split('\n').find(l => l.includes('Top:'));
  assert.match(topLine, /<@d>.*<@b>.*<@c>/s);
  assert.ok(!topLine.includes('<@a>'));
});

test('renderPushReportLine: no pledges yet omits the Top line', async () => {
  await setupTestDb();
  resetTables();
  const callId = makeCall({});
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const line = renderPushReportLine(call, 'guild1');
  assert.ok(!line.includes('Top:'));
  assert.match(line, /0 senders/);
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

test('buildPushReportPayload: pagination buttons carry the requester filter forward', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 15; i++) makeCall({ author_id: '555' });

  const payload = buildPushReportPayload({ offset: 0, requesterId: '555' }).components[0].toJSON();
  assert.equal(payload.components[1].custom_id, 'admin:push-report:page:10:555');
});

test('buildPushReportPayload: no filter uses "_" sentinel in the customId', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 15; i++) makeCall({});

  const payload = buildPushReportPayload({ offset: 0 }).components[0].toJSON();
  assert.equal(payload.components[1].custom_id, 'admin:push-report:page:10:_');
});

test('handlePushReportPage: parses offset and filter out of the customId and updates the interaction', async () => {
  await setupTestDb();
  resetTables();
  for (let i = 0; i < 12; i++) makeCall({ author_id: '777' });

  let updated = null;
  const interaction = {
    customId: 'admin:push-report:page:10:777',
    guildId: 'g1',
    update: async (p) => { updated = p; },
  };
  await handlePushReportPage(interaction);
  assert.ok(updated);
  const embed = updated.embeds[0].toJSON();
  assert.match(embed.title, /<@777>/);
  assert.match(embed.title, /page 2\/2/);
});

test('handlePushReportPage: "_" filter tag means no requester filter', async () => {
  await setupTestDb();
  resetTables();
  makeCall({ author_id: '1' });
  makeCall({ author_id: '2' });

  let updated = null;
  const interaction = {
    customId: 'admin:push-report:page:0:_',
    guildId: 'g1',
    update: async (p) => { updated = p; },
  };
  await handlePushReportPage(interaction);
  const embed = updated.embeds[0].toJSON();
  assert.match(embed.footer.text, /^2 pushes total$/);
});
