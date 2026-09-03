import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCommand, routeButton, routeSelect, routeModal } from '../src/handlers/router.js';

function stubInteraction(overrides) {
  let captured = null;
  const base = {
    replied: false,
    deferred: false,
    reply:     async (p) => { captured = p; return p; },
    editReply: async (p) => { captured = p; return p; },
    followUp:  async (p) => { captured = p; return p; },
    guild: null,
    user: { id: '1' },
    options: { getSubcommand: () => undefined },
  };
  const interaction = { ...base, ...overrides };
  return { interaction, getCaptured: () => captured };
}

function withFeatures(value, fn) {
  const prev = process.env.FEATURES;
  process.env.FEATURES = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FEATURES;
    else process.env.FEATURES = prev;
  }
}

test('routeCommand: disabled command replies "not enabled" instead of dispatching', async () => {
  await withFeatures('scout,resources,map', async () => {
    const { interaction, getCaptured } = stubInteraction({ commandName: 'offense' });
    await routeCommand(interaction);
    assert.match(getCaptured().content, /not enabled/i);
  });
});

test('routeCommand: enabled command still dispatches normally', async () => {
  await withFeatures('scout,resources,map', async () => {
    const { interaction, getCaptured } = stubInteraction({
      commandName: 'scout',
      options: {
        getString: (name) => (name === 'coords' ? 'invalid-coords' : null),
      },
    });
    await routeCommand(interaction);
    // Reaches the real scout handler (not the gate) — invalid coords is its own error path.
    assert.match(getCaptured().content, /Invalid coordinates/i);
  });
});

test('routeButton: disabled feature button replies "not enabled"', async () => {
  await withFeatures('scout,resources,map', async () => {
    const { interaction, getCaptured } = stubInteraction({ customId: 'call:defense' });
    await routeButton(interaction);
    assert.match(getCaptured().content, /not enabled/i);
  });
});

test('routeButton: unmapped ids (core) are never gated', async () => {
  await withFeatures('scout,resources,map', async () => {
    const { interaction, getCaptured } = stubInteraction({ customId: 'panel:calls' });
    await routeButton(interaction);
    assert.ok(!/not enabled/i.test(getCaptured()?.content ?? ''));
  });
});

test('routeSelect: disabled feature select replies "not enabled"', async () => {
  await withFeatures('scout,resources,map', async () => {
    const { interaction, getCaptured } = stubInteraction({ customId: 'intel:window_pick' });
    await routeSelect(interaction);
    assert.match(getCaptured().content, /not enabled/i);
  });
});

test('routeModal: disabled feature modal replies "not enabled"', async () => {
  await withFeatures('scout,resources,map', async () => {
    const { interaction, getCaptured } = stubInteraction({ customId: 'timer:custom_submit' });
    await routeModal(interaction);
    assert.match(getCaptured().content, /not enabled/i);
  });
});

test('routeModal: enabled-feature modal id is not gated (falls through to real routing)', async () => {
  await withFeatures('scout,resources,map', async () => {
    const { interaction, getCaptured } = stubInteraction({ customId: 'whois:lookup' });
    await routeModal(interaction);
    // Reaches the real whois modal handler rather than the gate reply.
    assert.ok(!/not enabled/i.test(getCaptured()?.content ?? ''));
  });
});
