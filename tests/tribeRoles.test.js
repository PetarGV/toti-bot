import test from 'node:test';
import assert from 'node:assert/strict';
import { TRIBE_ROLE_NAMES, buildTribeRolePlan } from '../src/utils/tribeRoles.js';

test('TRIBE_ROLE_NAMES contains only playable tribes', () => {
  assert.deepEqual(
    TRIBE_ROLE_NAMES.slice().sort(),
    ['Egyptians', 'Gauls', 'Huns', 'Romans', 'Spartans', 'Teutons'],
  );
});

test('buildTribeRolePlan returns null when tid is unplayable', () => {
  assert.equal(buildTribeRolePlan({ tid: 4, memberRoleNames: [] }), null);
  assert.equal(buildTribeRolePlan({ tid: 5, memberRoleNames: ['Gauls'] }), null);
  assert.equal(buildTribeRolePlan({ tid: 999, memberRoleNames: [] }), null);
});

test('buildTribeRolePlan adds the target tribe and removes other tribe roles', () => {
  const plan = buildTribeRolePlan({ tid: 3, memberRoleNames: ['Romans', 'Off Crew'] });
  assert.deepEqual(plan.addRoleNames, ['Gauls']);
  assert.deepEqual(plan.removeRoleNames, ['Romans']);
});

test('buildTribeRolePlan is a no-op if member already has the target tribe role', () => {
  const plan = buildTribeRolePlan({ tid: 3, memberRoleNames: ['Gauls', 'Def Crew'] });
  assert.deepEqual(plan.addRoleNames, []);
  assert.deepEqual(plan.removeRoleNames, []);
});

test('buildTribeRolePlan removes ALL other tribe roles, not just one', () => {
  const plan = buildTribeRolePlan({ tid: 1, memberRoleNames: ['Gauls', 'Teutons', 'Huns'] });
  assert.deepEqual(plan.addRoleNames, ['Romans']);
  assert.deepEqual(plan.removeRoleNames.slice().sort(), ['Gauls', 'Huns', 'Teutons']);
});
