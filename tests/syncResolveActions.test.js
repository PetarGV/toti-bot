import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import {
  applyConflictAction,
  computeConflicts,
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

test('computeConflicts walks the current map+audit and returns conflict rows', async () => {
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
  assert.equal(rows.length, 1);
  assert.equal(rows[0].discordId, '111');
  assert.equal(rows[0].existingIgn, 'Alpha');
  assert.equal(rows[0].targetIgn, 'Beta');
});
