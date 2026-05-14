import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleTranslate } from '../../src/handlers/translate.js';
import { translationCache } from '../../src/utils/translation/cache.js';
import { _resetRateLimit } from '../../src/utils/translation/rateLimit.js';

let originalFetch;
let originalKey;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalKey = process.env.DEEPL_API_KEY;
  process.env.DEEPL_API_KEY = 'test-key';
  translationCache.clear();
  _resetRateLimit();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DEEPL_API_KEY;
  else process.env.DEEPL_API_KEY = originalKey;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeInteraction({ text = 'Hallo Welt', to = null, locale = 'en-GB', userId = 'user-1' } = {}) {
  const calls = [];
  return {
    user: { id: userId },
    locale,
    options: {
      getString(name, required) {
        if (name === 'text') {
          if (required && text == null) throw new Error('missing text');
          return text;
        }
        if (name === 'to') return to;
        return null;
      },
    },
    async reply(payload) {
      calls.push(['reply', payload]);
      this.replied = true;
    },
    async deferReply(payload) {
      calls.push(['deferReply', payload]);
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push(['editReply', payload]);
      this.replied = true;
    },
    calls,
  };
}

test('translate slash replies with an ephemeral translation embed', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello world', detected_source_language: 'DE' }],
  });
  const interaction = makeInteraction({ to: 'EN-GB' });

  await handleTranslate(interaction);

  assert.deepEqual(interaction.calls[0], ['deferReply', { ephemeral: true }]);
  const payload = interaction.calls[1][1];
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, '🌐 Translation');
  assert.match(embed.description, /Hallo Welt/);
  assert.match(embed.description, /Hello world/);
  assert.match(embed.footer.text, /DE -> 🇬🇧 EN-GB/);
});

test('translate slash uses interaction locale when to is omitted', async () => {
  let body;
  globalThis.fetch = async (_url, opts) => {
    body = opts.body.toString();
    return jsonResponse({ translations: [{ text: 'Bonjour', detected_source_language: 'EN' }] });
  };
  const interaction = makeInteraction({ text: 'Hello', to: null, locale: 'fr' });

  await handleTranslate(interaction);

  assert.match(body, /target_lang=FR/);
});

test('translate slash falls back to English and includes a locale note', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello', detected_source_language: 'JA' }],
  });
  const interaction = makeInteraction({ text: 'こんにちは', to: null, locale: 'ja' });

  await handleTranslate(interaction);

  const payload = interaction.calls[1][1];
  assert.match(payload.content, /locale `ja` is not supported/);
  assert.match(payload.embeds[0].toJSON().footer.text, /EN-GB/);
});

test('translate slash reuses cached translations', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({ translations: [{ text: 'Hello world', detected_source_language: 'DE' }] });
  };

  await handleTranslate(makeInteraction({ userId: 'a' }));
  const second = makeInteraction({ userId: 'b' });
  await handleTranslate(second);

  assert.equal(calls, 1);
  assert.match(second.calls[1][1].embeds[0].toJSON().footer.text, /cached/);
});

test('translate slash validates empty and oversize text before calling DeepL', async () => {
  globalThis.fetch = async () => {
    throw new Error('should not be called');
  };

  const empty = makeInteraction({ text: '   ' });
  await handleTranslate(empty);
  assert.deepEqual(empty.calls[0], ['reply', { content: 'Nothing to translate.', ephemeral: true }]);

  const oversize = makeInteraction({ text: 'x'.repeat(5001) });
  await handleTranslate(oversize);
  assert.deepEqual(oversize.calls[0], ['reply', { content: 'Text too long (max 5000 chars). Try splitting it.', ephemeral: true }]);
});

test('translate slash reports missing API key privately', async () => {
  delete process.env.DEEPL_API_KEY;
  globalThis.fetch = async () => {
    throw new Error('should not be called');
  };
  const interaction = makeInteraction();

  await handleTranslate(interaction);

  assert.deepEqual(interaction.calls[0], ['reply', {
    content: "Translation isn't configured on this server. Ask an admin to set it up.",
    ephemeral: true,
  }]);
});

test('translate slash rate limits per user', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello', detected_source_language: 'DE' }],
  });
  for (let i = 0; i < 10; i++) {
    await handleTranslate(makeInteraction({ text: `Hallo ${i}`, userId: 'limited' }));
  }

  const blocked = makeInteraction({ text: 'Hallo 11', userId: 'limited' });
  await handleTranslate(blocked);

  assert.equal(blocked.calls[0][0], 'reply');
  assert.match(blocked.calls[0][1].content, /translation limit \(10\/min\)/);
});

test('translate slash maps DeepL auth, quota, and upstream failures to private messages', async () => {
  const cases = [
    [403, /rejected the request/],
    [456, /Monthly translation quota reached/],
    [500, /Translation service is down/],
  ];

  for (const [status, expected] of cases) {
    translationCache.clear();
    _resetRateLimit();
    globalThis.fetch = async () => new Response('bad', { status });
    const interaction = makeInteraction({ text: `x ${status}` });

    await handleTranslate(interaction);

    assert.match(interaction.calls[1][1].content, expected);
  }
});
