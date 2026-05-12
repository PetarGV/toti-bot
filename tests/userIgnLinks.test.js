import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import {
  setUserIgnFromInput,
  adminLink,
  adminUnlink,
  adminSetPrimary,
  getPrimaryLinkForUser,
  getAllLinksForUser,
  getDualsForUser,
  getUsersByIgn,
} from '../src/handlers/userIgnLinks.js';

function seed(userId) {
  prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(userId);
}

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid, population) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid, r.population ?? 100);
  }
}

test('setUserIgnFromInput rejects unknown ign', async () => {
  await setupTestDb();
  resetTables();
  seed('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);

  const result = setUserIgnFromInput('111', 'Bogus');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
});

test('setUserIgnFromInput creates the account+link with primary=1', async () => {
  await setupTestDb();
  resetTables();
  seed('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);

  const result = setUserIgnFromInput('111', 'real');
  assert.equal(result.ok, true);
  assert.equal(result.canonical, 'Real');
  const link = getPrimaryLinkForUser('111');
  assert.equal(link.ign, 'Real');
  assert.equal(link.is_primary, 1);
  assert.equal(link.source, 'self');
});

test('setUserIgnFromInput replaces a prior self/sync link but keeps admin links', async () => {
  await setupTestDb();
  resetTables();
  seed('111');
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
    { id: 3, x: 2, y: 2, player: 'Gamma', uid: 12 },
  ]);

  setUserIgnFromInput('111', 'Alpha');         // self → primary Alpha
  adminLink('111', 'Beta');                     // admin → secondary Beta
  setUserIgnFromInput('111', 'Gamma');          // self → primary Gamma; Alpha gone; Beta stays

  const links = getAllLinksForUser('111').map(l => ({ ign: l.ign, is_primary: l.is_primary, source: l.source }));
  assert.deepEqual(
    links.sort((a, b) => a.ign.localeCompare(b.ign)),
    [
      { ign: 'Beta',  is_primary: 0, source: 'admin' },
      { ign: 'Gamma', is_primary: 1, source: 'self' },
    ],
  );
});

test('setUserIgnFromInput on an existing admin-linked ign promotes it to primary', async () => {
  await setupTestDb();
  resetTables();
  seed('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 }]);

  adminLink('111', 'Alpha');                    // admin link, is_primary=0
  setUserIgnFromInput('111', 'Alpha');          // user claims it themselves

  const links = getAllLinksForUser('111');
  assert.equal(links.length, 1);
  assert.equal(links[0].ign, 'Alpha');
  assert.equal(links[0].is_primary, 1);
  assert.equal(links[0].source, 'admin'); // source preserved; primary flipped
});

test('adminLink rejects unknown ign and is a no-op when already linked', async () => {
  await setupTestDb();
  resetTables();
  seed('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);

  assert.equal(adminLink('111', 'Bogus').ok, false);
  assert.equal(adminLink('111', 'Real').ok, true);
  assert.equal(adminLink('111', 'Real').ok, true); // idempotent
  assert.equal(getAllLinksForUser('111').length, 1);
});

test('adminUnlink promotes the oldest remaining link when removing primary', async () => {
  await setupTestDb();
  resetTables();
  seed('111');
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
    { id: 3, x: 2, y: 2, player: 'Gamma', uid: 12 },
  ]);

  setUserIgnFromInput('111', 'Alpha'); // primary
  adminLink('111', 'Beta');             // secondary, oldest of the rest
  adminLink('111', 'Gamma');            // secondary, newer
  adminUnlink('111', 'Alpha');

  const primary = getPrimaryLinkForUser('111');
  assert.equal(primary.ign, 'Beta');
});

test('adminSetPrimary flips primary between existing links', async () => {
  await setupTestDb();
  resetTables();
  seed('111');
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
  ]);

  setUserIgnFromInput('111', 'Alpha');
  adminLink('111', 'Beta');
  adminSetPrimary('111', 'Beta');

  const primary = getPrimaryLinkForUser('111');
  assert.equal(primary.ign, 'Beta');
  const all = getAllLinksForUser('111');
  assert.equal(all.find(l => l.ign === 'Alpha').is_primary, 0);
});

test('getDualsForUser returns union across all linked accounts, deduped', async () => {
  await setupTestDb();
  resetTables();
  seed('111'); seed('222'); seed('333');
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Main', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Farm', uid: 11 },
  ]);
  setUserIgnFromInput('111', 'Main');
  adminLink('111', 'Farm');             // Petar has Main + Farm
  setUserIgnFromInput('222', 'Main');   // Sara shares Main
  setUserIgnFromInput('333', 'Farm');   // Tom shares Farm

  const duals = getDualsForUser('111').map(d => d.discord_id).sort();
  assert.deepEqual(duals, ['222', '333']);
});

test('getUsersByIgn returns all Discord users linked to that ign', async () => {
  await setupTestDb();
  resetTables();
  seed('111'); seed('222');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Main', uid: 10 }]);
  setUserIgnFromInput('111', 'Main');
  setUserIgnFromInput('222', 'Main');

  const users = getUsersByIgn('main').map(u => u.discord_id).sort();
  assert.deepEqual(users, ['111', '222']);
});
