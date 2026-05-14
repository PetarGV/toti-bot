import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCommand } from '../src/handlers/router.js';

test('router dispatches /translate to the translation handler', async () => {
  const originalKey = process.env.DEEPL_API_KEY;
  delete process.env.DEEPL_API_KEY;
  const calls = [];

  try {
    await routeCommand({
      commandName: 'translate',
      user: { id: 'user-1' },
      locale: 'en-GB',
      options: {
        getString() {
          return 'Hallo Welt';
        },
      },
      async reply(payload) {
        calls.push(['reply', payload]);
      },
    });
  } finally {
    if (originalKey === undefined) delete process.env.DEEPL_API_KEY;
    else process.env.DEEPL_API_KEY = originalKey;
  }

  assert.equal(calls[0][0], 'reply');
  assert.equal(
    calls[0][1].content,
    "Translation isn't configured on this server. Ask an admin to set it up.",
  );
});
