import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { applyMemberMapProfileMatches } from '../src/commands/admin.js';
import { setUserIgnFromInput, adminLink, getPrimaryLinkForUser, getAllLinksForUser } from '../src/handlers/userIgnLinks.js';
import { upsertAccountFromMap } from '../src/handlers/travianAccounts.js';

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid) VALUES (?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid);
  }
}

function makeAudit(matched) {
  return { totalMembers: matched.length, totalPlayers: 0, matched, ambiguous: [], unmatched: [] };
}

test('applyMemberMapProfileMatches creates a primary sync link for a fresh user', async () => {
  await setupTestDb();
  resetTables();
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');

  const audit = makeAudit([{
    member: { id: '111' },
    displayName: 'Real',
    player: { player: 'Real', normalizedName: 'real' },
  }]);

  const result = applyMemberMapProfileMatches(audit);
  assert.equal(result.updated.length, 1);
  assert.equal(result.alreadyLinked.length, 0);
  assert.equal(result.conflicts.length, 0);

  const primary = getPrimaryLinkForUser('111');
  assert.equal(primary.ign, 'Real');
  assert.equal(primary.source, 'sync');
});

test('applyMemberMapProfileMatches skips users with any existing link', async () => {
  await setupTestDb();
  resetTables();
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Alpha', uid: 10 },
    { id: 2, x: 1, y: 1, player: 'Beta',  uid: 11 },
  ]);
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('222');

  setUserIgnFromInput('111', 'Alpha');   // already linked, sync wants different
  adminLink('222', 'Alpha');              // admin-linked as secondary, sync wants same

  const audit = makeAudit([
    { member: { id: '111' }, displayName: 'Beta',  player: { player: 'Beta',  normalizedName: 'beta'  } },
    { member: { id: '222' }, displayName: 'Alpha', player: { player: 'Alpha', normalizedName: 'alpha' } },
  ]);

  const result = applyMemberMapProfileMatches(audit);
  assert.equal(result.updated.length, 0);
  assert.equal(result.conflicts.length, 1);     // 111 — different primary
  assert.equal(result.alreadyLinked.length, 1); // 222 — already linked to same ign
});
