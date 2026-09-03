import test from 'node:test';
import assert from 'node:assert/strict';
import { isEnabled, enabledFeatures, featureForId, COMMAND_FEATURES, PANEL_FEATURES } from '../src/utils/features.js';

function withFeatures(value, fn) {
  const prev = process.env.FEATURES;
  if (value === undefined) delete process.env.FEATURES;
  else process.env.FEATURES = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FEATURES;
    else process.env.FEATURES = prev;
  }
}

test('isEnabled: unset FEATURES enables everything', () => {
  withFeatures(undefined, () => {
    assert.equal(isEnabled('scout'), true);
    assert.equal(isEnabled('defense'), true);
    assert.equal(isEnabled('anything-unlisted'), true);
    assert.equal(isEnabled(undefined), true);
  });
});

test('isEnabled: blank FEATURES enables everything', () => {
  withFeatures('  ', () => {
    assert.equal(isEnabled('scout'), true);
  });
});

test('isEnabled: set FEATURES enables only the listed features', () => {
  withFeatures('scout,resources,map', () => {
    assert.equal(isEnabled('scout'), true);
    assert.equal(isEnabled('resources'), true);
    assert.equal(isEnabled('map'), true);
    assert.equal(isEnabled('defense'), false);
    assert.equal(isEnabled('timer'), false);
  });
});

test('isEnabled: whitespace around FEATURES entries is trimmed', () => {
  withFeatures(' scout , resources ', () => {
    assert.equal(isEnabled('scout'), true);
    assert.equal(isEnabled('resources'), true);
    assert.equal(isEnabled('defense'), false);
  });
});

test('enabledFeatures: null when unset, array of names when set', () => {
  withFeatures(undefined, () => {
    assert.equal(enabledFeatures(), null);
  });
  withFeatures('scout,resources', () => {
    assert.deepEqual(enabledFeatures(), ['scout', 'resources']);
  });
});

test('featureForId: resolves entry-point buttons/modals to their feature', () => {
  assert.equal(featureForId('push:lumber'), 'resources');
  assert.equal(featureForId('pledge:submit:5'), 'resources');
  assert.equal(featureForId('scout:join:5'), 'scout');
  assert.equal(featureForId('call:scout'), 'scout');
  assert.equal(featureForId('call:defense'), 'defense');
  assert.equal(featureForId('call:offense'), 'offense');
  assert.equal(featureForId('call:def_active'), 'defense');
  assert.equal(featureForId('timer:preset:7m'), 'timer');
  assert.equal(featureForId('profile:edit-ign'), 'profile');
  assert.equal(featureForId('panel:status'), 'status');
  assert.equal(featureForId('setup:roles:def'), 'roles');
});

test('featureForId: longest-prefix-wins disambiguates intel:whois from the generic intel prefix', () => {
  assert.equal(featureForId('intel:whois'), 'map');
  assert.equal(featureForId('intel:refresh'), 'defense');
  assert.equal(featureForId('general:nearby'), 'map');
});

test('featureForId: unmapped ids (core/admin/sync/onboarding) are ungated', () => {
  assert.equal(featureForId('panel:calls'), null);
  assert.equal(featureForId('sync:resolve-conflicts:1'), null);
  assert.equal(featureForId('onboard:start:1'), null);
  assert.equal(featureForId('help:category'), null);
});

test('COMMAND_FEATURES omits always-on core commands', () => {
  for (const core of ['setup', 'admin', 'calls', 'help', 'translate']) {
    assert.equal(COMMAND_FEATURES[core], undefined);
  }
});

test('PANEL_FEATURES covers every panel type exactly once', () => {
  const types = ['offense', 'resources', 'scout', 'general', 'roles', 'timer', 'reports', 'leadership', 'leadership-banner'];
  for (const type of types) {
    assert.ok(PANEL_FEATURES[type], `missing PANEL_FEATURES entry for "${type}"`);
  }
});
