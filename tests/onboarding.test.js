import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { getNextStep } from '../src/handlers/onboarding.js';
import { setUserIgnFromInput } from '../src/handlers/userIgnLinks.js';
import { setAccountCoords } from '../src/handlers/travianAccounts.js';

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid) VALUES (?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid);
  }
}

test('getNextStep returns ign when user has no primary link', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');

  const step = getNextStep({ discordId: '111', memberRoleNames: ['Off Crew'] });
  assert.equal(step, 'ign');
});

test('getNextStep returns role when user has IGN but no crew role', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  setUserIgnFromInput('111', 'Real');

  const step = getNextStep({ discordId: '111', memberRoleNames: ['@everyone'] });
  assert.equal(step, 'role');
});

test('getNextStep returns coords when user has IGN and role but no home_x', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  setUserIgnFromInput('111', 'Real');

  const step = getNextStep({ discordId: '111', memberRoleNames: ['Def Crew'] });
  assert.equal(step, 'coords');
});

test('getNextStep returns done when everything is set', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  setUserIgnFromInput('111', 'Real');
  setAccountCoords('Real', -10, 25);

  const step = getNextStep({ discordId: '111', memberRoleNames: ['Off Crew'] });
  assert.equal(step, 'done');
});

test('Hybrid role counts as having a crew role', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  setUserIgnFromInput('111', 'Real');

  const step = getNextStep({ discordId: '111', memberRoleNames: ['Hybrid', 'Def Crew'] });
  assert.equal(step, 'coords'); // not 'role'
});
