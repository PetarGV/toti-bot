import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { getProfile, setNotifyPledges, buildProfilePayload } from '../src/handlers/profile.js';
import { setUserIgnFromInput } from '../src/handlers/userIgnLinks.js';

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid, tid) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid, r.tid ?? 1);
  }
}

test('getProfile returns null fields when user has no link', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  const p = getProfile('111');
  assert.equal(p.ign, null);
  assert.equal(p.home_x, null);
});

test('getProfile surfaces the primary linked account', async () => {
  await setupTestDb();
  resetTables();
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setUserIgnFromInput('111', 'Real');

  const p = getProfile('111');
  assert.equal(p.ign, 'Real');
});

test('setNotifyPledges writes to users.notify_pledges', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setNotifyPledges('111', 1);
  const u = prepare('SELECT notify_pledges FROM users WHERE discord_id = ?').get('111');
  assert.equal(u.notify_pledges, 1);
});

test('buildProfilePayload shows Start setup button when user has no link', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  const payload = buildProfilePayload('111');
  const customIds = payload.components.flatMap(row => row.toJSON().components.map(c => c.custom_id));
  assert.ok(customIds.includes('onboard:start:111'));
  // No edit-IGN, edit-coords, or tribe-select components.
  assert.ok(!customIds.includes('profile:edit-ign'));
  assert.ok(!customIds.includes('profile:edit-coords'));
  assert.ok(!customIds.includes('profile:tribe-select'));
});

test('buildProfilePayload omits Start setup when user has a primary link', async () => {
  await setupTestDb();
  resetTables();
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setUserIgnFromInput('111', 'Real');

  const payload = buildProfilePayload('111');
  const customIds = payload.components.flatMap(row => row.toJSON().components.map(c => c.custom_id));
  assert.ok(!customIds.some(id => id.startsWith('onboard:start:')));
  // DM toggle still present.
  assert.ok(customIds.includes('notify:toggle'));
});
