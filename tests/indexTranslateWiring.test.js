import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('index wires translation reaction intents, partials, startup warning, and listener', () => {
  assert.match(source, /Partials/);
  assert.match(source, /GatewayIntentBits\.GuildMessages/);
  assert.match(source, /GatewayIntentBits\.GuildMessageReactions/);
  assert.match(source, /GatewayIntentBits\.MessageContent/);
  assert.match(source, /Partials\.Message/);
  assert.match(source, /Partials\.Channel/);
  assert.match(source, /Partials\.Reaction/);
  assert.match(source, /handleTranslateReaction/);
  assert.match(source, /Events\.MessageReactionAdd/);
  assert.match(source, /DEEPL_API_KEY not set/);
});
