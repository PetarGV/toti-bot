import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { groupByIgn, handleLeaderboardCommand } from '../src/handlers/leaderboard.js';
import { setUserIgnFromInput, adminLink } from '../src/handlers/userIgnLinks.js';

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid) VALUES (?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid);
  }
}

test('groupByIgn collapses duals (shared primary ign) into one bucket', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('222');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Main', uid: 10 }]);
  setUserIgnFromInput('111', 'Main');
  setUserIgnFromInput('222', 'Main'); // dual

  const rows = [
    { user_id: '111', value: 3 },
    { user_id: '222', value: 4 },
  ];
  // Note: groupByIgn takes valueKeys as an array
  const out = groupByIgn(rows, ['value']);
  assert.equal(out.length, 1);
  assert.equal(out[0].ign, 'Main');
  assert.equal(out[0].value, 7);
});

test('groupByIgn ignores secondary links — only primary counts', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Main', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Farm', uid: 11 },
  ]);
  setUserIgnFromInput('111', 'Main');
  adminLink('111', 'Farm'); // secondary

  const rows = [{ user_id: '111', value: 5 }];
  const out = groupByIgn(rows, ['value']);
  assert.equal(out.length, 1);
  assert.equal(out[0].ign, 'Main');
  assert.equal(out[0].value, 5);
});

test('scout leaderboard counts reports but excludes typed commitments', async () => {
  await setupTestDb();
  resetTables();

  const callId = prepare(`
    INSERT INTO calls (type, author_id, x, y)
    VALUES ('scout', 'requester-1', 10, 20)
    RETURNING id
  `).get().id;

  prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
    .run(callId, 'committed-scout', JSON.stringify({ kind: 'scout_commitment', amount: '75 scouts' }));
  prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
    .run(callId, 'typed-reporter', JSON.stringify({ kind: 'scout_report', text: 'Wall is empty' }));
  prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
    .run(callId, 'legacy-reporter', 'Legacy wall report');

  const replies = [];
  const interaction = {
    options: { getString: () => 'scouts' },
    async reply(payload) {
      replies.push(payload);
    },
  };

  await handleLeaderboardCommand(interaction);

  const description = replies[0].embeds[0].data.description;
  assert.match(description, /<@typed-reporter>.*\*\*1\*\* reports/);
  assert.match(description, /<@legacy-reporter>.*\*\*1\*\* reports/);
  assert.doesNotMatch(description, /<@committed-scout>/);
});
