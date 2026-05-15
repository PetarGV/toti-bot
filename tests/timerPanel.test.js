import test from 'node:test';
import assert from 'node:assert/strict';
import { ButtonStyle } from 'discord.js';
import { buildPanel, PANEL_TYPES } from '../src/panel/types.js';
import { commandDefinitions } from '../src/commands/definitions.js';

test('timer is a valid panel type', () => {
  assert.ok(PANEL_TYPES.includes('timer'));
});

test('buildPanel("timer") renders correct title and button layout', () => {
  const payload = buildPanel('timer');
  const embed = payload.embeds[0].toJSON();
  const rows = payload.components.map(r => r.toJSON().components);

  assert.equal(embed.title, '⏱️ Timer Control');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.length), [4, 3]);

  assert.deepEqual(
    rows.flat().map(c => c.custom_id),
    [
      'timer:preset:7m',
      'timer:preset:10m',
      'timer:preset:13m',
      'timer:custom',
      'timer:pause',
      'timer:stop',
      'timer:status',
    ],
  );

  // Pause is warning-ish, Stop is danger, others secondary
  const stopBtn = rows.flat().find(c => c.custom_id === 'timer:stop');
  assert.equal(stopBtn.style, ButtonStyle.Danger);
});

test('/setup exposes a timer subcommand', () => {
  const setup = commandDefinitions.find(c => c.name === 'setup');
  assert.ok(setup);
  assert.ok(setup.options.some(o => o.name === 'timer'));
});
