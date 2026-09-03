import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { buildResourceRoster, buildResourceRosterPayload, handleResourceRosterPage } from '../src/handlers/resourceRoster.js';

function makeCall({ type = 'push:lumber', x = 0, y = 0, status = 'open' }) {
  const { lastInsertRowid } = prepare(`
    INSERT INTO calls (type, author_id, x, y, status, payload)
    VALUES (?, '1', ?, ?, ?, '{"resource":"lumber","amount":1000}')
  `).run(type, x, y, status);
  return lastInsertRowid;
}

function pledge(callId, userId, amount) {
  prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)').run(callId, userId, String(amount));
}

test('buildResourceRoster: sums pledges per user across multiple pushes', async () => {
  await setupTestDb();
  resetTables();
  const c1 = makeCall({});
  const c2 = makeCall({});
  pledge(c1, 'a', 1000);
  pledge(c2, 'a', 2000);
  pledge(c1, 'b', 500);

  const roster = buildResourceRoster(['a', 'b']);
  const a = roster.find(r => r.user_id === 'a');
  const b = roster.find(r => r.user_id === 'b');
  assert.equal(a.total, 3000);
  assert.equal(a.pushes, 2);
  assert.equal(b.total, 500);
  assert.equal(b.pushes, 1);
});

test('buildResourceRoster: members with no pledges default to 0/0, not omitted', async () => {
  await setupTestDb();
  resetTables();
  const c1 = makeCall({});
  pledge(c1, 'a', 1000);

  const roster = buildResourceRoster(['a', 'b', 'c']);
  assert.equal(roster.length, 3);
  const zeroRows = roster.filter(r => r.total === 0);
  assert.equal(zeroRows.length, 2);
  assert.deepEqual(zeroRows.map(r => r.user_id).sort(), ['b', 'c']);
});

test('buildResourceRoster: excludes pledges to non-push call types', async () => {
  await setupTestDb();
  resetTables();
  const pushCall = makeCall({});
  pledge(pushCall, 'a', 1000);
  const scoutCall = prepare(`
    INSERT INTO calls (type, author_id, x, y, status, payload) VALUES ('scout', '1', 0, 0, 'open', '{}')
  `).run().lastInsertRowid;
  pledge(scoutCall, 'a', 999999); // scout "pledge" (report), should not count toward resources

  const roster = buildResourceRoster(['a']);
  assert.equal(roster[0].total, 1000);
});

test('buildResourceRoster: sorted by total desc, tie broken by push count desc', async () => {
  await setupTestDb();
  resetTables();
  const c1 = makeCall({});
  const c2 = makeCall({});
  const c3 = makeCall({});
  pledge(c1, 'low', 100);
  pledge(c1, 'high', 5000);
  pledge(c2, 'tieA', 1000);
  pledge(c1, 'tieB', 500);
  pledge(c2, 'tieB', 500); // tieB: 1000 total across 2 pushes, ties tieA's 1000 total but more pushes

  const roster = buildResourceRoster(['low', 'high', 'tieA', 'tieB']);
  assert.deepEqual(roster.map(r => r.user_id), ['high', 'tieB', 'tieA', 'low']);
});

test('buildResourceRosterPayload: empty roster shows "No members found"', async () => {
  await setupTestDb();
  resetTables();
  const payload = buildResourceRosterPayload([], 0);
  assert.match(payload.embeds[0].toJSON().description, /No members found/);
});

test('buildResourceRosterPayload: top 3 get medals, rest are numbered', async () => {
  await setupTestDb();
  resetTables();
  const roster = [
    { user_id: 'a', total: 100, pushes: 1 },
    { user_id: 'b', total: 90, pushes: 1 },
    { user_id: 'c', total: 80, pushes: 1 },
    { user_id: 'd', total: 0, pushes: 0 },
  ];
  const embed = buildResourceRosterPayload(roster, 0).embeds[0].toJSON();
  const lines = embed.description.split('\n');
  assert.match(lines[0], /^🥇/);
  assert.match(lines[1], /^🥈/);
  assert.match(lines[2], /^🥉/);
  assert.match(lines[3], /^4\./);
  assert.match(lines[3], /0 pushes/);
});

test('buildResourceRosterPayload: paginates at 20 per page with correct disabled states', async () => {
  await setupTestDb();
  resetTables();
  const roster = Array.from({ length: 25 }, (_, i) => ({ user_id: String(i), total: 25 - i, pushes: 1 }));

  const page1 = buildResourceRosterPayload(roster, 0);
  assert.equal(page1.embeds[0].toJSON().description.split('\n').length, 20);
  const page1Row = page1.components[0].toJSON();
  assert.equal(page1Row.components[0].disabled, true);
  assert.equal(page1Row.components[1].disabled, false);

  const page2 = buildResourceRosterPayload(roster, 20);
  assert.equal(page2.embeds[0].toJSON().description.split('\n').length, 5);
  const page2Row = page2.components[0].toJSON();
  assert.equal(page2Row.components[0].disabled, false);
  assert.equal(page2Row.components[1].disabled, true);
  // rank continues from 21, not restarting at 1
  assert.match(page2.embeds[0].toJSON().description.split('\n')[0], /^21\./);
});

test('handleResourceRosterPage: fetches guild members (excluding bots), builds roster, and updates', async () => {
  await setupTestDb();
  resetTables();
  const c1 = makeCall({});
  pledge(c1, 'human1', 5000);

  const fakeMembers = new Map([
    ['human1', { id: 'human1', user: { bot: false } }],
    ['human2', { id: 'human2', user: { bot: false } }],
    ['botid',  { id: 'botid',  user: { bot: true } }],
  ]);

  let updated = null;
  const interaction = {
    customId: 'report:roster:page:0',
    guild: { members: { fetch: async () => fakeMembers } },
    update: async (p) => { updated = p; },
  };
  await handleResourceRosterPage(interaction);

  const desc = updated.embeds[0].toJSON().description;
  assert.match(desc, /<@human1>/);
  assert.match(desc, /<@human2>/);
  assert.ok(!desc.includes('<@botid>'));
  assert.match(updated.embeds[0].toJSON().footer.text, /^2 members$/);
});
