import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import {
  applyConflictAction,
  computeConflicts,
  applyAmbiguousPick,
  computeAmbiguous,
} from '../src/handlers/syncResolve.js';
import { setUserIgnFromInput, getPrimaryLinkForUser, getAllLinksForUser } from '../src/handlers/userIgnLinks.js';

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid) VALUES (?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid);
  }
}

test('applyConflictAction "replace" overwrites the user\'s primary regardless of source', async () => {
  await setupTestDb();
  resetTables();
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
  ]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setUserIgnFromInput('111', 'Alpha'); // primary, source=self

  const r = applyConflictAction({ action: 'replace', discordId: '111', targetIgn: 'Beta' });
  assert.equal(r.ok, true);
  assert.equal(getPrimaryLinkForUser('111').ign, 'Beta');
});

test('applyConflictAction "secondary" leaves primary alone and adds as is_primary=0', async () => {
  await setupTestDb();
  resetTables();
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
  ]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setUserIgnFromInput('111', 'Alpha');

  const r = applyConflictAction({ action: 'secondary', discordId: '111', targetIgn: 'Beta' });
  assert.equal(r.ok, true);
  const links = getAllLinksForUser('111');
  assert.equal(links.length, 2);
  assert.equal(getPrimaryLinkForUser('111').ign, 'Alpha');
  assert.equal(links.find(l => l.ign === 'Beta').is_primary, 0);
});

test('applyConflictAction rejects an already-resolved row', async () => {
  await setupTestDb();
  resetTables();
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
  ]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setUserIgnFromInput('111', 'Beta'); // user has resolved themselves since the report

  const r = applyConflictAction({ action: 'replace', discordId: '111', targetIgn: 'Beta' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'already_resolved');
});

test('computeConflicts skips users that already have any link', async () => {
  await setupTestDb();
  resetTables();
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
  ]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setUserIgnFromInput('111', 'Alpha');

  const audit = {
    matched: [{
      member: { id: '111', displayName: 'Beta' },
      displayName: 'Beta',
      player: { player: 'Beta', normalizedName: 'beta' },
    }],
    ambiguous: [],
    unmatched: [],
  };
  const rows = computeConflicts(audit);
  assert.deepEqual(rows, []);
});

test('computeAmbiguous returns audit.ambiguous mapped to picker rows', async () => {
  await setupTestDb();
  resetTables();
  const audit = {
    matched: [], unmatched: [],
    ambiguous: [{
      member: { id: '111' },
      displayName: 'Person',
      players: [{ player: 'Alpha' }, { player: 'Beta' }],
    }],
  };
  const rows = computeAmbiguous(audit);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].candidates.sort(), ['Alpha', 'Beta']);
});

test('applyAmbiguousPick on a user with no link sets primary directly', async () => {
  await setupTestDb();
  resetTables();
  seedMap([{ id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 }]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');

  const r = applyAmbiguousPick({ discordId: '111', pickedIgn: 'Alpha' });
  assert.equal(r.ok, true);
  assert.equal(r.next, 'done'); // no follow-up needed
});

test('applyAmbiguousPick on a user with an existing primary returns next=conflict', async () => {
  await setupTestDb();
  resetTables();
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
  ]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  setUserIgnFromInput('111', 'Alpha');

  const r = applyAmbiguousPick({ discordId: '111', pickedIgn: 'Beta' });
  assert.equal(r.ok, true);
  assert.equal(r.next, 'conflict');
});
