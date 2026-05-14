import test from 'node:test';
import assert from 'node:assert/strict';
import { commandDefinitions } from '../src/commands/definitions.js';
import { SUPPORTED_LANGS } from '../src/utils/translation/locales.js';

test('/translate command exposes required text and optional target language choices', () => {
  const command = commandDefinitions.find((entry) => entry.name === 'translate');

  assert.ok(command);
  assert.equal(command.description, 'Translate text with DeepL');

  const text = command.options.find((option) => option.name === 'text');
  assert.ok(text);
  assert.equal(text.required, true);

  const to = command.options.find((option) => option.name === 'to');
  assert.ok(to);
  assert.equal(to.required, false);
  assert.deepEqual(to.choices.map((choice) => choice.value), SUPPORTED_LANGS);
});
