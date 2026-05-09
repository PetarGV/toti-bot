import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREW_ROLE_NAMES,
  buildRoleUpdatePlan,
  getRoleSelection,
} from '../src/utils/roleSelection.js';

test('role selections expose the exact Discord role names to manage', () => {
  assert.deepEqual(CREW_ROLE_NAMES, ['Def Crew', 'Off Crew', 'Hybrid', 'Scout Crew']);
  assert.deepEqual(getRoleSelection('def').roleNames, ['Def Crew']);
  assert.deepEqual(getRoleSelection('off').roleNames, ['Off Crew']);
  assert.deepEqual(getRoleSelection('hybrid').roleNames, ['Hybrid', 'Def Crew']);
  assert.deepEqual(getRoleSelection('scout').roleNames, ['Scout Crew']);
});

test('buildRoleUpdatePlan adds hybrid and def crew while removing other crew roles', () => {
  const plan = buildRoleUpdatePlan('hybrid', ['Off Crew', 'Scout Crew'], CREW_ROLE_NAMES);

  assert.deepEqual(plan.addRoleNames, ['Hybrid', 'Def Crew']);
  assert.deepEqual(plan.removeRoleNames, ['Off Crew', 'Scout Crew']);
  assert.deepEqual(plan.missingRoleNames, []);
});

test('buildRoleUpdatePlan keeps already assigned target roles out of add operations', () => {
  const plan = buildRoleUpdatePlan('def', ['Def Crew', 'Hybrid'], CREW_ROLE_NAMES);

  assert.deepEqual(plan.addRoleNames, []);
  assert.deepEqual(plan.removeRoleNames, ['Hybrid']);
  assert.deepEqual(plan.missingRoleNames, []);
});

test('buildRoleUpdatePlan reports missing required Discord roles', () => {
  const plan = buildRoleUpdatePlan('scout', ['Def Crew'], ['Def Crew', 'Off Crew', 'Hybrid']);

  assert.deepEqual(plan.addRoleNames, []);
  assert.deepEqual(plan.removeRoleNames, ['Def Crew']);
  assert.deepEqual(plan.missingRoleNames, ['Scout Crew']);
});

test('buildRoleUpdatePlan rejects unknown role selections', () => {
  assert.throws(
    () => buildRoleUpdatePlan('unknown', [], CREW_ROLE_NAMES),
    /Unknown role selection/,
  );
});
