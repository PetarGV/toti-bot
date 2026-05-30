import test from 'node:test';
import assert from 'node:assert/strict';
import { getTier } from '../src/utils/tier.js';

function fakeMember(roleNames) {
  return { roles: { cache: { some: pred => roleNames.some(n => pred({ name: n })) } } };
}

test('getTier returns leadership when member has leadership role', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['Leadership', 'Member']);
  assert.equal(getTier(m), 'leadership');
});

test('getTier returns def_coord when only def coord role', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['Defense Coordinator']);
  assert.equal(getTier(m), 'def_coord');
});

test('getTier returns member when no privileged role', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['SomeRandomRole']);
  assert.equal(getTier(m), 'member');
});

test('getTier prefers leadership over def_coord when member has both', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['Leadership', 'Defense Coordinator']);
  assert.equal(getTier(m), 'leadership');
});

test('getTier handles null member', () => {
  assert.equal(getTier(null), 'member');
});
