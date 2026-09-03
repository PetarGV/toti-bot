import test from 'node:test';
import assert from 'node:assert/strict';

// definitions.js and panel/types.js compute their filtered lists at module
// load time from process.env.FEATURES, so exercising a non-default value
// requires a fresh module instance — force one with a cache-busting query.
async function loadWithFeatures(value, specifier) {
  const prev = process.env.FEATURES;
  process.env.FEATURES = value;
  try {
    return await import(`${specifier}?bust=${Date.now()}-${Math.random()}`);
  } finally {
    if (prev === undefined) delete process.env.FEATURES;
    else process.env.FEATURES = prev;
  }
}

test('commandDefinitions: FEATURES=scout,resources,map hides gated commands and keeps core + enabled ones', async () => {
  const { commandDefinitions } = await loadWithFeatures('scout,resources,map', '../src/commands/definitions.js');
  const names = commandDefinitions.map(c => c.name);

  for (const expected of ['setup', 'admin', 'calls', 'help', 'translate', 'scout', 'push', 'whois', 'nearby']) {
    assert.ok(names.includes(expected), `expected "${expected}" to be registered`);
  }
  for (const hidden of ['offense', 'report-incoming', 'active-def', 'perma-def', 'sending-def', 'intel', 'reclassify', 'status', 'profile', 'timer', 'leaderboard']) {
    assert.ok(!names.includes(hidden), `expected "${hidden}" to be hidden`);
  }
});

test('commandDefinitions: /setup only exposes subcommands for enabled panels', async () => {
  const { commandDefinitions } = await loadWithFeatures('scout,resources,map', '../src/commands/definitions.js');
  const setup = commandDefinitions.find(c => c.name === 'setup');
  const subNames = setup.options.map(o => o.name);
  assert.deepEqual(subNames.sort(), ['resources', 'scout']);
});

test('commandDefinitions: unset FEATURES registers every command (regression)', async () => {
  const prev = process.env.FEATURES;
  delete process.env.FEATURES;
  try {
    const { commandDefinitions } = await import(`../src/commands/definitions.js?bust=${Date.now()}-${Math.random()}`);
    const names = commandDefinitions.map(c => c.name);
    for (const expected of ['offense', 'report-incoming', 'active-def', 'perma-def', 'sending-def', 'intel', 'reclassify', 'status', 'profile', 'timer', 'leaderboard', 'scout', 'push', 'whois', 'nearby']) {
      assert.ok(names.includes(expected), `expected "${expected}" to be registered when FEATURES is unset`);
    }
  } finally {
    if (prev === undefined) delete process.env.FEATURES;
    else process.env.FEATURES = prev;
  }
});

test('PANEL_TYPES: FEATURES=scout,resources,map keeps only scout and resources panels', async () => {
  const { PANEL_TYPES } = await loadWithFeatures('scout,resources,map', '../src/panel/types.js');
  assert.deepEqual([...PANEL_TYPES].sort(), ['resources', 'scout']);
});

test('PANEL_TYPES: unset FEATURES keeps every panel type (regression)', async () => {
  const prev = process.env.FEATURES;
  delete process.env.FEATURES;
  try {
    const { PANEL_TYPES } = await import(`../src/panel/types.js?bust=${Date.now()}-${Math.random()}`);
    assert.deepEqual([...PANEL_TYPES].sort(), ['general', 'leadership', 'leadership-banner', 'offense', 'reports', 'resources', 'roles', 'scout', 'timer']);
  } finally {
    if (prev === undefined) delete process.env.FEATURES;
    else process.env.FEATURES = prev;
  }
});
