import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import {
  validateIgnAgainstMap,
  upsertAccountFromMap,
  findAccountByNormalizedIgn,
  setAccountCoords,
  setAccountTribe,
} from '../src/handlers/travianAccounts.js';

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid, population) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid, r.population ?? 100);
  }
}

test('validateIgnAgainstMap accepts an exact map name', async () => {
  await setupTestDb();
  resetTables();
  seedMap([{ id: 1, x: 0, y: 0, player: 'Lord Vader', uid: 10 }]);

  const result = validateIgnAgainstMap('lord vader');
  assert.equal(result.ok, true);
  assert.equal(result.canonical, 'Lord Vader');
});

test('validateIgnAgainstMap rejects unknown names', async () => {
  await setupTestDb();
  resetTables();
  seedMap([{ id: 1, x: 0, y: 0, player: 'Lord Vader', uid: 10 }]);

  const result = validateIgnAgainstMap('Not A Player');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
});

test('validateIgnAgainstMap flags multi-uid collisions as ambiguous', async () => {
  await setupTestDb();
  resetTables();
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Alpha', uid: 11 },
  ]);

  const result = validateIgnAgainstMap('Alpha');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('upsertAccountFromMap creates a row and findAccountByNormalizedIgn fetches it', async () => {
  await setupTestDb();
  resetTables();
  upsertAccountFromMap('Lord Vader');
  const a = findAccountByNormalizedIgn('lordvader');
  assert.equal(a.ign, 'Lord Vader');
  assert.equal(a.normalized_ign, 'lordvader');
  assert.equal(a.home_x, null);
});

test('setAccountCoords/setAccountTribe persist values on the account', async () => {
  await setupTestDb();
  resetTables();
  upsertAccountFromMap('Lord Vader');
  setAccountCoords('Lord Vader', -12, 34);
  setAccountTribe('Lord Vader', 2);
  const a = findAccountByNormalizedIgn('lordvader');
  assert.equal(a.home_x, -12);
  assert.equal(a.home_y, 34);
  assert.equal(a.tribe, 2);
});
