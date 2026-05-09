import test from 'node:test';
import assert from 'node:assert/strict';
import { ButtonStyle } from 'discord.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { buildPanel, PANEL_TYPES } from '../src/panel/types.js';
import { ROLE_BUTTON_PREFIX, ROLE_RESET_CUSTOM_ID } from '../src/utils/roleSelection.js';

test('/setup exposes a roles subcommand', () => {
  const setup = commandDefinitions.find((command) => command.name === 'setup');

  assert.ok(setup);
  assert.ok(setup.options.some((option) => option.name === 'roles'));
});

test('roles panel renders persistent role buttons and a reset button', () => {
  assert.ok(PANEL_TYPES.includes('roles'));

  const payload = buildPanel('roles');
  const embed = payload.embeds[0].toJSON();
  const rows = payload.components.map((row) => row.toJSON().components);

  assert.equal(embed.title, 'Choose Your Crew Role');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.length), [3, 2, 1]);
  assert.deepEqual(
    rows.flat().map((component) => component.custom_id),
    [
      `${ROLE_BUTTON_PREFIX}:def`,
      `${ROLE_BUTTON_PREFIX}:off`,
      `${ROLE_BUTTON_PREFIX}:scout`,
      `${ROLE_BUTTON_PREFIX}:hybrid`,
      `${ROLE_BUTTON_PREFIX}:wwk`,
      ROLE_RESET_CUSTOM_ID,
    ],
  );
  assert.deepEqual(
    rows.flat().map((component) => component.emoji?.name ?? null),
    ['🟢', '🔴', '🔵', '🟠', '⚫', '♻️'],
  );
  assert.deepEqual(
    rows.flat().map((component) => component.style),
    [
      ButtonStyle.Success,
      ButtonStyle.Danger,
      ButtonStyle.Primary,
      ButtonStyle.Secondary,
      ButtonStyle.Secondary,
      ButtonStyle.Danger,
    ],
  );
});
