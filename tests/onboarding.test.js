import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { getNextStep, applyCoordsAndDeriveTribe, buildWizardPayload, buildWelcomePayload } from '../src/handlers/onboarding.js';
import { setUserIgnFromInput, getPrimaryLinkForUser } from '../src/handlers/userIgnLinks.js';
import { setAccountCoords } from '../src/handlers/travianAccounts.js';

function seedMap(rows) {
  for (const r of rows) {
    prepare('INSERT INTO x_world (id, x, y, player, uid, tid) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.x, r.y, r.player, r.uid, r.tid ?? null);
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

function makeMockMember(roleNames = []) {
  const roles = new Map(roleNames.map((n, i) => [`r${i}`, { id: `r${i}`, name: n }]));
  const added = []; const removed = [];
  return {
    id: '111',
    roles: {
      cache: roles,
      add:    async (r) => { added.push(...(Array.isArray(r) ? r : [r])); },
      remove: async (r) => { removed.push(...(Array.isArray(r) ? r : [r])); },
    },
    guild: {
      roles: { cache: new Map([
        ['gaul-role-id', { id: 'gaul-role-id', name: 'Gauls' }],
        ['rom-role-id',  { id: 'rom-role-id',  name: 'Romans' }],
      ])},
    },
    _added: added,
    _removed: removed,
  };
}

test('applyCoordsAndDeriveTribe rejects invalid coords format', async () => {
  await setupTestDb();
  resetTables();
  const r = await applyCoordsAndDeriveTribe({
    discordId: '111', coordsString: 'nonsense', member: makeMockMember(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid_coords');
});

test('applyCoordsAndDeriveTribe rejects when no village exists at coords', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([{ id: 1, x: 0, y: 0, player: 'Real', uid: 10 }]);
  setUserIgnFromInput('111', 'Real');

  const r = await applyCoordsAndDeriveTribe({
    discordId: '111', coordsString: '99|99', member: makeMockMember(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_village');
});

test('applyCoordsAndDeriveTribe rejects Nature/Natars villages', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Real', uid: 10, tid: 3 },
    { id: 2, x: 5, y: 5, player: 'Nature', uid: 0, tid: 4 },
  ]);
  setUserIgnFromInput('111', 'Real');

  const r = await applyCoordsAndDeriveTribe({
    discordId: '111', coordsString: '5|5', member: makeMockMember(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'npc_village');
});

test('applyCoordsAndDeriveTribe rejects when village owner != primary IGN', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([
    { id: 1, x: 0, y: 0, player: 'Real',  uid: 10, tid: 3 },
    { id: 2, x: 5, y: 5, player: 'Other', uid: 11, tid: 1 },
  ]);
  setUserIgnFromInput('111', 'Real');

  const r = await applyCoordsAndDeriveTribe({
    discordId: '111', coordsString: '5|5', member: makeMockMember(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'wrong_owner');
  assert.equal(r.villageOwner, 'Other');
  assert.equal(r.primaryIgn, 'Real');
});

test('applyCoordsAndDeriveTribe writes coords + tribe and assigns the Discord role', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([{ id: 1, x: -10, y: 25, player: 'Real', uid: 10, tid: 3 }]); // Gauls
  setUserIgnFromInput('111', 'Real');

  const member = makeMockMember(['Romans']); // member previously had Romans — should be removed
  const r = await applyCoordsAndDeriveTribe({
    discordId: '111', coordsString: '-10|25', member,
  });
  assert.equal(r.ok, true);
  assert.equal(r.tribeName, 'Gauls');

  const link = getPrimaryLinkForUser('111');
  assert.equal(link.home_x, -10);
  assert.equal(link.home_y, 25);
  assert.equal(link.tribe, 3);

  assert.deepEqual(member._added.map(r => r.name), ['Gauls']);
  assert.deepEqual(member._removed.map(r => r.name), ['Romans']);
});

test('applyCoordsAndDeriveTribe logs warning + still saves data when tribe role is missing on the server', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO users (discord_id) VALUES (?)').run('111');
  seedMap([{ id: 1, x: -10, y: 25, player: 'Real', uid: 10, tid: 7 }]); // Huns
  setUserIgnFromInput('111', 'Real');

  const member = makeMockMember(); // guild has no Huns role
  const r = await applyCoordsAndDeriveTribe({
    discordId: '111', coordsString: '-10|25', member,
  });
  assert.equal(r.ok, true);
  assert.equal(r.roleAssigned, false); // signals missing-role case
  const link = getPrimaryLinkForUser('111');
  assert.equal(link.tribe, 7); // coords + tribe still saved
});

test('buildWizardPayload renders step 1 of 3 for the ign step', () => {
  const payload = buildWizardPayload({ step: 'ign', discordId: '111' });
  assert.match(payload.content, /Step 1 of 3/);
  assert.match(payload.content, /in-game name/i);
  const customIds = payload.components.flatMap(row =>
    row.toJSON().components.map(c => c.custom_id),
  );
  assert.ok(customIds.includes('onboard:set-ign'));
});

test('buildWizardPayload renders step 2 with role buttons + Continue advance button', () => {
  const payload = buildWizardPayload({ step: 'role', discordId: '111' });
  assert.match(payload.content, /Step 2 of 3/);
  const customIds = payload.components.flatMap(row =>
    row.toJSON().components.map(c => c.custom_id),
  );
  assert.ok(customIds.some(id => id.startsWith('setup:roles:')));
  assert.ok(customIds.includes('onboard:advance:111'));
});

test('buildWizardPayload renders step 3 with Set Coords + Skip', () => {
  const payload = buildWizardPayload({ step: 'coords', discordId: '111' });
  assert.match(payload.content, /Step 3 of 3/);
  const customIds = payload.components.flatMap(row =>
    row.toJSON().components.map(c => c.custom_id),
  );
  assert.ok(customIds.includes('onboard:set-coords'));
  assert.ok(customIds.includes('onboard:skip:111'));
});

test('buildWizardPayload "done" returns a celebratory message and no action buttons', () => {
  const payload = buildWizardPayload({ step: 'done', discordId: '111' });
  assert.match(payload.content, /all set/i);
  assert.equal(payload.components.length, 0);
});

test('buildWelcomePayload pings the new member and exposes a Start setup button', () => {
  const payload = buildWelcomePayload({ memberId: '777', rolesPanelUrl: null });
  assert.match(payload.content, /<@777>/);
  const startBtn = payload.components[0].toJSON().components[0];
  assert.equal(startBtn.custom_id, 'onboard:start:777');
  assert.equal(startBtn.label, '🚀 Start setup');
});

test('buildWelcomePayload includes a link to the roles panel when available', () => {
  const payload = buildWelcomePayload({
    memberId: '777',
    rolesPanelUrl: 'https://discord.com/channels/g/c/m',
  });
  assert.match(payload.content, /https:\/\/discord\.com\/channels\/g\/c\/m/);
});
