import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { handleTranslateReaction, _resetDedup } from '../../src/handlers/translateReaction.js';
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
  _resetDedup();
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

function makeUser({ id = 'user-1', bot = false } = {}) {
  return { id, bot };
}

function makeThread({ id = 'thread-1', messages = [] } = {}) {
  return {
    id,
    _sent: [],
    isThread: () => true,
    guild: { members: { me: { id: 'bot' } } },
    permissionsFor: () => ({
      has(bit) {
        return bit === PermissionFlagsBits.SendMessagesInThreads || bit === PermissionFlagsBits.CreatePublicThreads;
      },
    }),
    messages: {
      async fetch() {
        return new Map(messages.map((message, idx) => [message.id ?? `m-${idx}`, message]));
      },
    },
    async send(payload) {
      this._sent.push(payload);
      return payload;
    },
  };
}

function makeChannel({ canCreate = true, canSend = true } = {}) {
  return {
    id: 'channel-1',
    isThread: () => false,
    guild: { members: { me: { id: 'bot' } } },
    permissionsFor: () => ({
      has(bit) {
        if (bit === PermissionFlagsBits.CreatePublicThreads) return canCreate;
        if (bit === PermissionFlagsBits.SendMessagesInThreads) return canSend;
        return true;
      },
    }),
  };
}

function makeMessage({
  id = 'message-1',
  content = 'Hallo Welt',
  thread = null,
  channel = makeChannel(),
  partial = false,
} = {}) {
  return {
    id,
    content,
    thread,
    channel,
    partial,
    _started: null,
    async fetch() {
      this.partial = false;
      this._messageFetched = true;
      return this;
    },
    async startThread(opts) {
      this._started = opts;
      this.thread = makeThread({ id: `${id}-thread` });
      return this.thread;
    },
  };
}

function makeReaction({ emoji = '🇬🇧', message = makeMessage(), partial = false } = {}) {
  return {
    emoji: { name: emoji },
    message,
    partial,
    async fetch() {
      this.partial = false;
      this._reactionFetched = true;
      return this;
    },
  };
}

test('reaction ignores unknown flags and missing API key silently', async () => {
  globalThis.fetch = async () => {
    throw new Error('should not be called');
  };
  const unknownThread = makeThread();
  await handleTranslateReaction(makeReaction({
    emoji: '👍',
    message: makeMessage({ thread: unknownThread }),
  }), makeUser());
  assert.equal(unknownThread._sent.length, 0);

  delete process.env.DEEPL_API_KEY;
  const noKeyThread = makeThread();
  await handleTranslateReaction(makeReaction({
    message: makeMessage({ thread: noKeyThread }),
  }), makeUser());
  assert.equal(noKeyThread._sent.length, 0);
});

test('reaction creates a translation thread and posts an embed', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello world', detected_source_language: 'DE' }],
  });
  const message = makeMessage();

  await handleTranslateReaction(makeReaction({ message }), makeUser({ id: 'alice' }));

  assert.deepEqual(message._started, { name: '🌐 Translations', autoArchiveDuration: 60 });
  assert.equal(message.thread._sent.length, 1);
  const embed = message.thread._sent[0].embeds[0].toJSON();
  assert.equal(embed.title, '🇬🇧 EN-GB (from DE)');
  assert.match(embed.description, /Hello world/);
  assert.match(embed.footer.text, /Triggered by <@alice>/);
});

test('reaction reuses an existing message thread', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Bonjour', detected_source_language: 'EN' }],
  });
  const thread = makeThread();
  const message = makeMessage({ thread });

  await handleTranslateReaction(makeReaction({ emoji: '🇫🇷', message }), makeUser());

  assert.equal(message._started, null);
  assert.equal(thread._sent.length, 1);
  assert.match(thread._sent[0].embeds[0].toJSON().title, /FR/);
});

test('reaction on a message inside a thread posts in that same thread', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello world', detected_source_language: 'DE' }],
  });
  const threadChannel = makeThread({ id: 'parent-thread' });
  const message = makeMessage({ channel: threadChannel, thread: null });

  await handleTranslateReaction(makeReaction({ message }), makeUser());

  assert.equal(threadChannel._sent.length, 1);
  assert.equal(message._started, null);
});

test('reaction prevents duplicate translations with memory dedup and thread scan', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello world', detected_source_language: 'DE' }],
  });
  const thread = makeThread();
  const message = makeMessage({ thread });

  await handleTranslateReaction(makeReaction({ message }), makeUser({ id: 'one' }));
  await handleTranslateReaction(makeReaction({ message }), makeUser({ id: 'two' }));
  assert.equal(thread._sent.length, 1);

  _resetDedup();
  const scannedThread = makeThread({
    messages: [{ author: { bot: true }, embeds: [{ title: '🇬🇧 EN-GB (from DE)' }] }],
  });
  await handleTranslateReaction(makeReaction({
    message: makeMessage({ id: 'message-2', thread: scannedThread }),
  }), makeUser());
  assert.equal(scannedThread._sent.length, 0);
});

test('reaction exits silently for missing permissions, empty content, oversize content, and DeepL errors', async () => {
  globalThis.fetch = async () => {
    throw new Error('should not be called');
  };

  const missingPerms = makeMessage({ channel: makeChannel({ canCreate: false }) });
  await handleTranslateReaction(makeReaction({ message: missingPerms }), makeUser());
  assert.equal(missingPerms.thread, null);

  const emptyThread = makeThread();
  await handleTranslateReaction(makeReaction({
    message: makeMessage({ content: '   ', thread: emptyThread }),
  }), makeUser());
  assert.equal(emptyThread._sent.length, 0);

  const oversizeThread = makeThread();
  await handleTranslateReaction(makeReaction({
    message: makeMessage({ content: 'x'.repeat(5001), thread: oversizeThread }),
  }), makeUser());
  assert.equal(oversizeThread._sent.length, 0);

  globalThis.fetch = async () => new Response('bad', { status: 500 });
  const deeplThread = makeThread();
  await handleTranslateReaction(makeReaction({
    message: makeMessage({ thread: deeplThread }),
  }), makeUser());
  assert.equal(deeplThread._sent.length, 0);
});

test('reaction shares cache across messages and rate limits per user', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return jsonResponse({ translations: [{ text: 'Hello world', detected_source_language: 'DE' }] });
  };

  const firstThread = makeThread();
  await handleTranslateReaction(makeReaction({
    message: makeMessage({ id: 'one', content: 'Hallo', thread: firstThread }),
  }), makeUser({ id: 'a' }));
  const secondThread = makeThread();
  await handleTranslateReaction(makeReaction({
    message: makeMessage({ id: 'two', content: 'Hallo', thread: secondThread }),
  }), makeUser({ id: 'b' }));

  assert.equal(fetchCalls, 1);
  assert.match(secondThread._sent[0].embeds[0].toJSON().footer.text, /cached/);

  for (let i = 0; i < 10; i++) {
    await handleTranslateReaction(makeReaction({
      emoji: '🇩🇪',
      message: makeMessage({ id: `rl-${i}`, content: `Hello ${i}`, thread: makeThread() }),
    }), makeUser({ id: 'limited' }));
  }
  const blockedThread = makeThread();
  await handleTranslateReaction(makeReaction({
    emoji: '🇩🇪',
    message: makeMessage({ id: 'blocked', content: 'Hello blocked', thread: blockedThread }),
  }), makeUser({ id: 'limited' }));
  assert.equal(blockedThread._sent.length, 0);
});

test('reaction fetches partial reaction and message before processing', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello world', detected_source_language: 'DE' }],
  });
  const thread = makeThread();
  const message = makeMessage({ thread, partial: true });
  const reaction = makeReaction({ message, partial: true });

  await handleTranslateReaction(reaction, makeUser());

  assert.equal(reaction._reactionFetched, true);
  assert.equal(message._messageFetched, true);
  assert.equal(thread._sent.length, 1);
});
