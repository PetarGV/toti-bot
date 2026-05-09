import test from 'node:test';
import assert from 'node:assert/strict';
import { commandDefinitions } from '../src/commands/definitions.js';
import { buildPanel, PANEL_TYPES } from '../src/panel/types.js';
import { ROLE_SELECT_CUSTOM_ID } from '../src/utils/roleSelection.js';

test('/setup exposes a roles subcommand', () => {
  const setup = commandDefinitions.find((command) => command.name === 'setup');

  assert.ok(setup);
  assert.ok(setup.options.some((option) => option.name === 'roles'));
});

test('roles panel renders one persistent role selection menu', () => {
  assert.ok(PANEL_TYPES.includes('roles'));

  const payload = buildPanel('roles');
  const embed = payload.embeds[0].toJSON();
  const component = payload.components[0].toJSON().components[0];

  assert.equal(embed.title, 'Choose Your Crew Role');
  assert.equal(component.custom_id, ROLE_SELECT_CUSTOM_ID);
  assert.deepEqual(
    component.options.map((option) => option.value),
    ['def', 'off', 'hybrid', 'scout'],
  );
});
