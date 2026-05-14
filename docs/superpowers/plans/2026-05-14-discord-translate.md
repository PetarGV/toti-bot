# Discord Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/translate` slash command and flag-reaction translation flow to the Travian alliance bot, backed by DeepL Free with an in-memory LRU cache and two-layer dedup. Spec: [docs/superpowers/specs/2026-05-14-discord-translate-design.md](../specs/2026-05-14-discord-translate-design.md).

**Architecture:** Five new utility / handler modules under `src/`, three light edits to existing files. Slash path replies ephemerally; reaction path posts in a `🌐 Translations` thread under the message and silently no-ops on errors. Translations are cached by `(targetLang, text)`; duplicate posts to the same thread are prevented by an in-memory set with a thread-message scan as a backstop.

**Tech Stack:** Node.js ES modules, discord.js v14, native `fetch` + `AbortSignal.timeout`, DeepL Free HTTP API, `node:test` (built-in test runner, no extra deps).

---

## File structure

```
src/
├── commands/
│   ├── definitions.js              [EDIT]   add /translate SlashCommandBuilder
│   └── deploy.js                   [no change]  re-run after registration
├── handlers/
│   ├── router.js                   [EDIT]   add /translate dispatch branch
│   ├── translate.js                [NEW]    slash command handler
│   └── translateReaction.js        [NEW]    flag reaction handler
├── index.js                        [EDIT]   add 3 intents + messageReactionAdd listener
└── utils/translation/
    ├── deepl.js                    [NEW]    fetch wrapper around DeepL Free
    ├── cache.js                    [NEW]    generic LRU + shared translationCache instance
    ├── locales.js                  [NEW]    supported langs, locale map, flag map, slash choices
    └── rateLimit.js                [NEW]    shared sliding-window rate limit

test/
├── translation/
│   ├── locales.test.js             [NEW]
│   ├── cache.test.js               [NEW]
│   ├── deepl.test.js               [NEW]
│   └── rateLimit.test.js           [NEW]
└── handlers/
    ├── translate.test.js           [NEW]
    └── translateReaction.test.js   [NEW]
```

**Note on rate limiter placement:** the spec says rate limiting "lives in one of the two handler files, imported by the other — minor implementation detail". This plan promotes it to `src/utils/translation/rateLimit.js` because both handlers import it and it has its own test file. Functionally identical to the spec.

**Test runner:** `node --test` auto-discovers files matching `test/**/*.test.js`. The existing `npm test` script already runs `node --test`.

---

## Task 1: Locales, flag map, and slash choices

**Files:**
- Create: `src/utils/translation/locales.js`
- Create: `test/translation/locales.test.js`

- [ ] **Step 1.1: Write the failing test**

Create `test/translation/locales.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_LANGS,
  FALLBACK_LANG,
  discordLocaleToDeepl,
  flagToDeepl,
  langChoices,
} from '../../src/utils/translation/locales.js';

test('SUPPORTED_LANGS contains 12 DeepL codes', () => {
  assert.equal(SUPPORTED_LANGS.length, 12);
  for (const code of ['EN-GB', 'EN-US', 'DE', 'FR', 'ES', 'RU', 'BG', 'PL', 'IT', 'NL', 'PT-PT', 'PT-BR']) {
    assert.ok(SUPPORTED_LANGS.includes(code), `missing ${code}`);
  }
});

test('FALLBACK_LANG is EN-GB', () => {
  assert.equal(FALLBACK_LANG, 'EN-GB');
});

test('discordLocaleToDeepl: maps known Discord locales', () => {
  assert.equal(discordLocaleToDeepl('en-US'), 'EN-US');
  assert.equal(discordLocaleToDeepl('en-GB'), 'EN-GB');
  assert.equal(discordLocaleToDeepl('de'), 'DE');
  assert.equal(discordLocaleToDeepl('pt-BR'), 'PT-BR');
  assert.equal(discordLocaleToDeepl('pt-PT'), 'PT-PT');
  assert.equal(discordLocaleToDeepl('bg'), 'BG');
});

test('discordLocaleToDeepl: returns null for unsupported locale', () => {
  assert.equal(discordLocaleToDeepl('ja'), null);
  assert.equal(discordLocaleToDeepl('zh-CN'), null);
  assert.equal(discordLocaleToDeepl(''), null);
  assert.equal(discordLocaleToDeepl(undefined), null);
});

test('flagToDeepl: maps known flag emojis', () => {
  assert.equal(flagToDeepl('🇬🇧'), 'EN-GB');
  assert.equal(flagToDeepl('🇺🇸'), 'EN-US');
  assert.equal(flagToDeepl('🇩🇪'), 'DE');
  assert.equal(flagToDeepl('🇫🇷'), 'FR');
  assert.equal(flagToDeepl('🇪🇸'), 'ES');
  assert.equal(flagToDeepl('🇷🇺'), 'RU');
  assert.equal(flagToDeepl('🇧🇬'), 'BG');
  assert.equal(flagToDeepl('🇵🇱'), 'PL');
  assert.equal(flagToDeepl('🇮🇹'), 'IT');
  assert.equal(flagToDeepl('🇳🇱'), 'NL');
  assert.equal(flagToDeepl('🇵🇹'), 'PT-PT');
  assert.equal(flagToDeepl('🇧🇷'), 'PT-BR');
});

test('flagToDeepl: returns null for non-flag emojis and unknown flags', () => {
  assert.equal(flagToDeepl('👍'), null);
  assert.equal(flagToDeepl('🇯🇵'), null);
  assert.equal(flagToDeepl(''), null);
  assert.equal(flagToDeepl(undefined), null);
});

test('langChoices: produces Discord-shaped choice objects for all supported langs', () => {
  const choices = langChoices();
  assert.equal(choices.length, SUPPORTED_LANGS.length);
  for (const choice of choices) {
    assert.ok(typeof choice.name === 'string' && choice.name.length > 0);
    assert.ok(SUPPORTED_LANGS.includes(choice.value));
  }
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="locales|FALLBACK|SUPPORTED|flagToDeepl|discordLocaleToDeepl|langChoices"`
Expected: tests FAIL with `Cannot find module '.../locales.js'`.

- [ ] **Step 1.3: Create the module**

Create `src/utils/translation/locales.js` with:

```js
// Single source of truth for translation language data.
// SUPPORTED_LANGS: the DeepL target codes we accept.
// DISCORD_TO_DEEPL: maps Discord client locale strings to a DeepL target code.
// FLAG_TO_DEEPL: maps regional-indicator flag emojis to a DeepL target code.
// FALLBACK_LANG: used when interaction.locale isn't in DISCORD_TO_DEEPL.

export const SUPPORTED_LANGS = [
  'EN-GB', 'EN-US', 'DE', 'FR', 'ES', 'RU',
  'BG', 'PL', 'IT', 'NL', 'PT-PT', 'PT-BR',
];

export const FALLBACK_LANG = 'EN-GB';

const DISCORD_TO_DEEPL = {
  'en-US': 'EN-US',
  'en-GB': 'EN-GB',
  'de':    'DE',
  'fr':    'FR',
  'es-ES': 'ES',
  'ru':    'RU',
  'bg':    'BG',
  'pl':    'PL',
  'it':    'IT',
  'nl':    'NL',
  'pt-BR': 'PT-BR',
  'pt-PT': 'PT-PT',
};

const FLAG_TO_DEEPL = {
  '🇬🇧': 'EN-GB',
  '🇺🇸': 'EN-US',
  '🇩🇪': 'DE',
  '🇫🇷': 'FR',
  '🇪🇸': 'ES',
  '🇷🇺': 'RU',
  '🇧🇬': 'BG',
  '🇵🇱': 'PL',
  '🇮🇹': 'IT',
  '🇳🇱': 'NL',
  '🇵🇹': 'PT-PT',
  '🇧🇷': 'PT-BR',
};

export function discordLocaleToDeepl(locale) {
  if (!locale) return null;
  return DISCORD_TO_DEEPL[locale] ?? null;
}

export function flagToDeepl(emoji) {
  if (!emoji) return null;
  return FLAG_TO_DEEPL[emoji] ?? null;
}

// Slash command choices: Discord allows max 25 options. We have 12.
export function langChoices() {
  return SUPPORTED_LANGS.map(code => ({ name: code, value: code }));
}
```

- [ ] **Step 1.4: Run tests, verify they pass**

Run: `npm test -- --test-name-pattern="locales|FALLBACK|SUPPORTED|flagToDeepl|discordLocaleToDeepl|langChoices"`
Expected: all 7 tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/translation/locales.js test/translation/locales.test.js
git commit -m "feat(translate): locale, flag, and slash-choice maps"
```

---

## Task 2: LRU translation cache

**Files:**
- Create: `src/utils/translation/cache.js`
- Create: `test/translation/cache.test.js`

- [ ] **Step 2.1: Write the failing test**

Create `test/translation/cache.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache, translationCache } from '../../src/utils/translation/cache.js';

test('LruCache: returns undefined for missing key', () => {
  const c = new LruCache(3);
  assert.equal(c.get('nope'), undefined);
  assert.equal(c.has('nope'), false);
});

test('LruCache: stores and retrieves values', () => {
  const c = new LruCache(3);
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('b'), 2);
  assert.equal(c.has('a'), true);
  assert.equal(c.size(), 2);
});

test('LruCache: evicts oldest entry when capacity exceeded', () => {
  const c = new LruCache(3);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.set('d', 4); // should evict 'a'
  assert.equal(c.has('a'), false);
  assert.equal(c.get('b'), 2);
  assert.equal(c.get('c'), 3);
  assert.equal(c.get('d'), 4);
  assert.equal(c.size(), 3);
});

test('LruCache: get() moves entry to most-recently-used', () => {
  const c = new LruCache(3);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.get('a');     // 'a' is now MRU; 'b' is oldest
  c.set('d', 4);  // should evict 'b', not 'a'
  assert.equal(c.has('a'), true);
  assert.equal(c.has('b'), false);
  assert.equal(c.has('c'), true);
  assert.equal(c.has('d'), true);
});

test('LruCache: set() on existing key moves it to MRU', () => {
  const c = new LruCache(3);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.set('a', 99); // overwrite + MRU; 'b' is oldest now
  c.set('d', 4);  // should evict 'b'
  assert.equal(c.get('a'), 99);
  assert.equal(c.has('b'), false);
});

test('translationCache: is an LruCache instance with capacity 500', () => {
  assert.ok(translationCache instanceof LruCache);
  // Fill beyond capacity to confirm bound
  for (let i = 0; i < 600; i++) translationCache.set(`fill-${i}`, i);
  assert.equal(translationCache.size(), 500);
  // Clean up the fill keys so other tests aren't affected
  for (let i = 0; i < 600; i++) {
    if (translationCache.has(`fill-${i}`)) translationCache.delete(`fill-${i}`);
  }
});
```

- [ ] **Step 2.2: Run test, verify it fails**

Run: `npm test -- --test-name-pattern="LruCache|translationCache"`
Expected: tests FAIL with `Cannot find module '.../cache.js'`.

- [ ] **Step 2.3: Create the module**

Create `src/utils/translation/cache.js` with:

```js
// Generic LRU cache using Map insertion order.
// On access (get) or update (set on existing key), the entry is re-inserted
// so it becomes the most recently used. When size exceeds capacity, the
// oldest (first-inserted) entry is dropped.

export class LruCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('LruCache capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  has(key) {
    return this.map.has(key);
  }

  delete(key) {
    return this.map.delete(key);
  }

  size() {
    return this.map.size;
  }
}

// Shared instance used by both translation handlers.
// Key format (composed by callers): `${targetLang}:${sourceText}`
// Value shape: { translation: string, detectedSourceLang: string }
export const translationCache = new LruCache(500);
```

- [ ] **Step 2.4: Run tests, verify they pass**

Run: `npm test -- --test-name-pattern="LruCache|translationCache"`
Expected: all 6 tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/utils/translation/cache.js test/translation/cache.test.js
git commit -m "feat(translate): in-memory LRU translation cache (cap 500)"
```

---

## Task 3: DeepL HTTP client

**Files:**
- Create: `src/utils/translation/deepl.js`
- Create: `test/translation/deepl.test.js`

- [ ] **Step 3.1: Write the failing test**

Create `test/translation/deepl.test.js` with:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { translate, DeeplError } from '../../src/utils/translation/deepl.js';

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler) {
  globalThis.fetch = async (url, opts) => handler(url, opts);
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('translate: parses successful response', async () => {
  mockFetch(async () => jsonResponse(200, {
    translations: [{ text: 'Hello world', detected_source_language: 'DE' }],
  }));
  const out = await translate({
    text: 'Hallo Welt',
    targetLang: 'EN-GB',
    apiKey: 'fake-key',
  });
  assert.equal(out.translation, 'Hello world');
  assert.equal(out.detectedSourceLang, 'DE');
});

test('translate: sends Authorization header and url-encoded body', async () => {
  let capturedUrl, capturedOpts;
  mockFetch(async (url, opts) => {
    capturedUrl = url;
    capturedOpts = opts;
    return jsonResponse(200, {
      translations: [{ text: 'x', detected_source_language: 'EN' }],
    });
  });
  await translate({ text: 'hi', targetLang: 'DE', apiKey: 'KEY-123' });
  assert.equal(capturedUrl, 'https://api-free.deepl.com/v2/translate');
  assert.equal(capturedOpts.method, 'POST');
  assert.equal(capturedOpts.headers['Authorization'], 'DeepL-Auth-Key KEY-123');
  assert.equal(capturedOpts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  // body is a URLSearchParams instance; check serialized form
  const body = capturedOpts.body.toString();
  assert.ok(body.includes('text=hi'));
  assert.ok(body.includes('target_lang=DE'));
});

test('translate: 403 throws DeeplError kind=auth', async () => {
  mockFetch(async () => new Response('forbidden', { status: 403 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'bad' }),
    (err) => err instanceof DeeplError && err.kind === 'auth' && err.status === 403,
  );
});

test('translate: 456 throws DeeplError kind=quota', async () => {
  mockFetch(async () => new Response('quota', { status: 456 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'quota' && err.status === 456,
  );
});

test('translate: 500 throws DeeplError kind=upstream', async () => {
  mockFetch(async () => new Response('boom', { status: 500 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'upstream' && err.status === 500,
  );
});

test('translate: other non-2xx throws DeeplError kind=http', async () => {
  mockFetch(async () => new Response('bad', { status: 400 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'http' && err.status === 400,
  );
});

test('translate: abort/timeout throws DeeplError kind=timeout', async () => {
  globalThis.fetch = async () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  };
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'timeout',
  );
});

test('translate: network error throws DeeplError kind=network', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'network',
  );
});

test('translate: unexpected response shape throws DeeplError kind=shape', async () => {
  mockFetch(async () => jsonResponse(200, { notTranslations: [] }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'shape',
  );
});
```

- [ ] **Step 3.2: Run test, verify it fails**

Run: `npm test -- --test-name-pattern="translate:"`
Expected: tests FAIL with `Cannot find module '.../deepl.js'`.

- [ ] **Step 3.3: Create the module**

Create `src/utils/translation/deepl.js` with:

```js
// Thin fetch wrapper around the DeepL Free translate endpoint.
// Owns: API endpoint, request shape, response parsing, error classification.
// Does not own: API key storage (caller passes it), caching, rate limiting.

const ENDPOINT = 'https://api-free.deepl.com/v2/translate';
const DEFAULT_TIMEOUT_MS = 8000;

export class DeeplError extends Error {
  constructor(kind, status, message) {
    super(message);
    this.name = 'DeeplError';
    this.kind = kind;     // 'auth' | 'quota' | 'upstream' | 'http' | 'timeout' | 'network' | 'shape'
    this.status = status; // HTTP status or 0 for non-HTTP failures
  }
}

export async function translate({ text, targetLang, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const body = new URLSearchParams({ text, target_lang: targetLang });
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new DeeplError('timeout', 0, 'DeepL request timed out');
    }
    throw new DeeplError('network', 0, err?.message || 'Network error');
  }

  if (res.status === 403) throw new DeeplError('auth',     403, 'DeepL rejected the API key');
  if (res.status === 456) throw new DeeplError('quota',    456, 'DeepL quota exceeded');
  if (res.status >= 500)  throw new DeeplError('upstream', res.status, `DeepL ${res.status}`);
  if (!res.ok)            throw new DeeplError('http',     res.status, `DeepL ${res.status}`);

  let json;
  try {
    json = await res.json();
  } catch {
    throw new DeeplError('shape', res.status, 'DeepL response was not valid JSON');
  }
  const out = json?.translations?.[0];
  if (!out || typeof out.text !== 'string') {
    throw new DeeplError('shape', res.status, 'Unexpected DeepL response shape');
  }
  return {
    translation: out.text,
    detectedSourceLang: out.detected_source_language || '',
  };
}
```

- [ ] **Step 3.4: Run tests, verify they pass**

Run: `npm test -- --test-name-pattern="translate:"`
Expected: all 9 tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/utils/translation/deepl.js test/translation/deepl.test.js
git commit -m "feat(translate): DeepL Free HTTP client with typed errors"
```

---

## Task 4: Shared rate limiter

**Files:**
- Create: `src/utils/translation/rateLimit.js`
- Create: `test/translation/rateLimit.test.js`

- [ ] **Step 4.1: Write the failing test**

Create `test/translation/rateLimit.test.js` with:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, _resetRateLimit } from '../../src/utils/translation/rateLimit.js';

beforeEach(() => {
  _resetRateLimit();
});

test('checkRateLimit: allows first 10 calls', () => {
  for (let i = 0; i < 10; i++) {
    const res = checkRateLimit('user-1', 1000 + i);
    assert.equal(res.allowed, true);
  }
});

test('checkRateLimit: rejects 11th call within window', () => {
  for (let i = 0; i < 10; i++) checkRateLimit('user-1', 1000);
  const res = checkRateLimit('user-1', 1500);
  assert.equal(res.allowed, false);
  assert.ok(res.retryInSec > 0 && res.retryInSec <= 60);
});

test('checkRateLimit: sliding window — old timestamps expire', () => {
  for (let i = 0; i < 10; i++) checkRateLimit('user-1', 1000);
  // 61 seconds later, all old timestamps are out of window
  const res = checkRateLimit('user-1', 1000 + 61_000);
  assert.equal(res.allowed, true);
});

test('checkRateLimit: separate users have separate buckets', () => {
  for (let i = 0; i < 10; i++) checkRateLimit('user-1', 1000);
  // user-1 is at the cap, but user-2 is fresh
  const res = checkRateLimit('user-2', 1000);
  assert.equal(res.allowed, true);
});

test('checkRateLimit: retryInSec reflects when oldest timestamp drops out', () => {
  // 10 calls at t=1000
  for (let i = 0; i < 10; i++) checkRateLimit('user-1', 1000);
  // Try at t=10000 (9s later) — oldest timestamp drops out at t=61000, so retry in 51s
  const res = checkRateLimit('user-1', 10_000);
  assert.equal(res.allowed, false);
  assert.equal(res.retryInSec, 51);
});
```

- [ ] **Step 4.2: Run test, verify it fails**

Run: `npm test -- --test-name-pattern="checkRateLimit"`
Expected: tests FAIL with `Cannot find module '.../rateLimit.js'`.

- [ ] **Step 4.3: Create the module**

Create `src/utils/translation/rateLimit.js` with:

```js
// Per-user sliding-window rate limit, shared across slash and reaction paths.
// Cap: 10 invocations per 60-second window.

const WINDOW_MS = 60_000;
const CAP = 10;
const buckets = new Map(); // userId -> sorted timestamps[] (ms)

export function checkRateLimit(userId, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  const prev = buckets.get(userId) ?? [];
  const recent = prev.filter(t => t > cutoff);

  if (recent.length >= CAP) {
    const oldest = recent[0];
    const retryInSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    buckets.set(userId, recent);
    return { allowed: false, retryInSec };
  }

  recent.push(now);
  buckets.set(userId, recent);
  return { allowed: true };
}

// Test-only helper. Do not call from production code.
export function _resetRateLimit() {
  buckets.clear();
}
```

- [ ] **Step 4.4: Run tests, verify they pass**

Run: `npm test -- --test-name-pattern="checkRateLimit"`
Expected: all 5 tests PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/utils/translation/rateLimit.js test/translation/rateLimit.test.js
git commit -m "feat(translate): shared per-user rate limiter (10/min sliding)"
```

---

## Task 5: Register `/translate` slash command

**Files:**
- Modify: `src/commands/definitions.js`

- [ ] **Step 5.1: Read the current head of definitions.js**

Read the first 5 lines of `src/commands/definitions.js` to confirm import format.

- [ ] **Step 5.2: Edit definitions.js — add the `/translate` builder**

In `src/commands/definitions.js`, append a new `SlashCommandBuilder` entry to the `commandDefinitions` array. The exact append location: immediately before the closing `];` of `commandDefinitions`.

Insert this block before the closing `];`:

```js
  // ── Translation ─────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text into your language or a chosen target')
    .addStringOption(o =>
      o.setName('text')
        .setDescription('Text to translate (up to 5000 chars)')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('to')
        .setDescription('Target language (defaults to your Discord locale)')
        .setRequired(false)
        .addChoices(
          { name: 'EN-GB', value: 'EN-GB' },
          { name: 'EN-US', value: 'EN-US' },
          { name: 'DE',    value: 'DE'    },
          { name: 'FR',    value: 'FR'    },
          { name: 'ES',    value: 'ES'    },
          { name: 'RU',    value: 'RU'    },
          { name: 'BG',    value: 'BG'    },
          { name: 'PL',    value: 'PL'    },
          { name: 'IT',    value: 'IT'    },
          { name: 'NL',    value: 'NL'    },
          { name: 'PT-PT', value: 'PT-PT' },
          { name: 'PT-BR', value: 'PT-BR' },
        )
    ),
```

The choices are hardcoded here (rather than imported from `langChoices()`) so that Discord's command JSON is fully static at registration time — no module-load order surprises during `deploy.js`.

- [ ] **Step 5.3: Sanity-check the definition compiles**

Run: `node -e "import('./src/commands/definitions.js').then(m => console.log('count:', m.commandDefinitions.length, 'has translate:', m.commandDefinitions.some(c => c.name === 'translate')))"`
Expected output: `count: <N>` (whatever N is) and `has translate: true`.

- [ ] **Step 5.4: Commit**

```bash
git add src/commands/definitions.js
git commit -m "feat(translate): register /translate slash command"
```

> **Deployment note:** the new command needs `node src/commands/deploy.js` to be re-run against Discord (covered in Task 10). The bot can be started before deploy, but the command won't appear in clients until then.

---

## Task 6: Slash command handler

**Files:**
- Create: `src/handlers/translate.js`
- Create: `test/handlers/translate.test.js`

The handler:
1. Defers reply ephemerally
2. Reads text + optional `to`
3. Validates length and non-empty
4. Resolves target language (explicit > locale > EN-GB)
5. Rate-limit check
6. Cache lookup; on miss, calls DeepL and stores
7. Renders an embed and edits the deferred reply

- [ ] **Step 6.1: Write the failing test**

Create `test/handlers/translate.test.js` with:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleTranslate } from '../../src/handlers/translate.js';
import { translationCache, LruCache } from '../../src/utils/translation/cache.js';
import { _resetRateLimit } from '../../src/utils/translation/rateLimit.js';

let originalFetch;
let originalKey;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalKey = process.env.DEEPL_API_KEY;
  process.env.DEEPL_API_KEY = 'test-key';
  _resetRateLimit();
  // wipe cache
  for (const k of [...translationCache.map.keys()]) translationCache.delete(k);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DEEPL_API_KEY;
  else process.env.DEEPL_API_KEY = originalKey;
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeInteraction({ locale = 'de', text = 'Hello', to = null, userId = 'u1' } = {}) {
  const state = { deferred: false, lastReply: null };
  return {
    _state: state,
    locale,
    user: { id: userId },
    options: {
      getString: (name) => {
        if (name === 'text') return text;
        if (name === 'to')   return to;
        return null;
      },
    },
    deferReply: async () => { state.deferred = true; },
    editReply: async (payload) => { state.lastReply = payload; },
    reply: async (payload) => { state.lastReply = payload; },
  };
}

test('translate slash: happy path uses Discord locale as default target', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hallo', detected_source_language: 'EN' }],
  });
  const i = makeInteraction({ locale: 'de', text: 'Hello' });
  await handleTranslate(i);
  assert.equal(i._state.deferred, true);
  assert.ok(i._state.lastReply.embeds?.[0]);
  const embed = i._state.lastReply.embeds[0].data ?? i._state.lastReply.embeds[0];
  // Embed description should contain the translation
  assert.ok(JSON.stringify(embed).includes('Hallo'));
});

test('translate slash: explicit `to` overrides locale', async () => {
  let capturedBody;
  globalThis.fetch = async (_url, opts) => {
    capturedBody = opts.body.toString();
    return jsonResponse({
      translations: [{ text: 'Bonjour', detected_source_language: 'EN' }],
    });
  };
  const i = makeInteraction({ locale: 'de', text: 'Hello', to: 'FR' });
  await handleTranslate(i);
  assert.ok(capturedBody.includes('target_lang=FR'));
});

test('translate slash: unsupported locale falls back to EN-GB with note', async () => {
  let capturedBody;
  globalThis.fetch = async (_url, opts) => {
    capturedBody = opts.body.toString();
    return jsonResponse({
      translations: [{ text: 'Hello', detected_source_language: 'DE' }],
    });
  };
  const i = makeInteraction({ locale: 'ja', text: 'Hallo' });
  await handleTranslate(i);
  assert.ok(capturedBody.includes('target_lang=EN-GB'));
  assert.ok(i._state.lastReply.content.includes("locale `ja` isn't supported"));
});

test('translate slash: empty input replies "Nothing to translate."', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const i = makeInteraction({ text: '   ' });
  await handleTranslate(i);
  assert.match(i._state.lastReply.content, /Nothing to translate/);
});

test('translate slash: oversize input rejected before any API call', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const i = makeInteraction({ text: 'x'.repeat(5001) });
  await handleTranslate(i);
  assert.match(i._state.lastReply.content, /Text too long/);
});

test('translate slash: rate limit after 10 calls in window', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'x', detected_source_language: 'EN' }],
  });
  for (let n = 0; n < 10; n++) {
    const i = makeInteraction({ text: `msg-${n}`, userId: 'rl-user' });
    await handleTranslate(i);
    assert.ok(i._state.lastReply.embeds, `call ${n} should have succeeded`);
  }
  const i11 = makeInteraction({ text: 'one more', userId: 'rl-user' });
  await handleTranslate(i11);
  assert.match(i11._state.lastReply.content, /translation limit/i);
});

test('translate slash: cache hit on identical (text, lang) skips API call', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({
      translations: [{ text: 'Hola', detected_source_language: 'EN' }],
    });
  };
  await handleTranslate(makeInteraction({ text: 'Hello', to: 'ES', userId: 'a' }));
  await handleTranslate(makeInteraction({ text: 'Hello', to: 'ES', userId: 'b' }));
  assert.equal(calls, 1);
});

test('translate slash: missing API key produces friendly reply, no fetch', async () => {
  delete process.env.DEEPL_API_KEY;
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const i = makeInteraction({ text: 'Hello' });
  await handleTranslate(i);
  assert.match(i._state.lastReply.content, /isn't configured/);
});

test('translate slash: DeepL 403 surfaces friendly reply', async () => {
  globalThis.fetch = async () => new Response('forbidden', { status: 403 });
  const i = makeInteraction({ text: 'Hello' });
  await handleTranslate(i);
  assert.match(i._state.lastReply.content, /rejected the request/);
});

test('translate slash: DeepL 456 surfaces quota message', async () => {
  globalThis.fetch = async () => new Response('quota', { status: 456 });
  const i = makeInteraction({ text: 'Hello' });
  await handleTranslate(i);
  assert.match(i._state.lastReply.content, /quota reached/);
});

test('translate slash: DeepL 500 surfaces service-down message', async () => {
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  const i = makeInteraction({ text: 'Hello' });
  await handleTranslate(i);
  assert.match(i._state.lastReply.content, /service is down/);
});
```

- [ ] **Step 6.2: Run test, verify it fails**

Run: `npm test -- --test-name-pattern="translate slash"`
Expected: tests FAIL with `Cannot find module '.../translate.js'`.

- [ ] **Step 6.3: Create the handler**

Create `src/handlers/translate.js` with:

```js
import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { translate, DeeplError } from '../utils/translation/deepl.js';
import { translationCache } from '../utils/translation/cache.js';
import { checkRateLimit } from '../utils/translation/rateLimit.js';
import {
  discordLocaleToDeepl,
  FALLBACK_LANG,
  SUPPORTED_LANGS,
} from '../utils/translation/locales.js';

const MAX_CHARS = 5000;

export async function handleTranslate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    return interaction.editReply({
      content: "Translation isn't configured on this server. Ask an admin to set it up.",
    });
  }

  const rawText = interaction.options.getString('text') ?? '';
  const text = rawText.trim();
  if (!text) {
    return interaction.editReply({ content: 'Nothing to translate.' });
  }
  if (text.length > MAX_CHARS) {
    return interaction.editReply({
      content: `Text too long (max ${MAX_CHARS} chars). Try splitting it.`,
    });
  }

  // Resolve target lang
  const explicitTo = interaction.options.getString('to');
  let targetLang;
  let unsupportedLocaleNote = null;

  if (explicitTo && SUPPORTED_LANGS.includes(explicitTo)) {
    targetLang = explicitTo;
  } else {
    const mapped = discordLocaleToDeepl(interaction.locale);
    if (mapped) {
      targetLang = mapped;
    } else {
      targetLang = FALLBACK_LANG;
      unsupportedLocaleNote =
        `Your locale \`${interaction.locale}\` isn't supported — showing English. ` +
        `Use \`/translate to:de\` to pick another.`;
    }
  }

  // Rate limit
  const rl = checkRateLimit(interaction.user.id);
  if (!rl.allowed) {
    return interaction.editReply({
      content: `You've hit the translation limit (10/min). Try again in ${rl.retryInSec}s.`,
    });
  }

  // Cache lookup
  const cacheKey = `${targetLang}:${text}`;
  let cached = translationCache.get(cacheKey);
  let fromCache = !!cached;
  let result = cached;

  if (!result) {
    try {
      result = await translate({ text, targetLang, apiKey });
    } catch (err) {
      return interaction.editReply({ content: friendlyDeeplError(err) });
    }
    translationCache.set(cacheKey, result);
  }

  const embed = buildSlashEmbed({
    sourceText: text,
    translation: result.translation,
    detectedSourceLang: result.detectedSourceLang,
    targetLang,
    fromCache,
  });

  const payload = { embeds: [embed] };
  if (unsupportedLocaleNote) payload.content = unsupportedLocaleNote;
  return interaction.editReply(payload);
}

function buildSlashEmbed({ sourceText, translation, detectedSourceLang, targetLang, fromCache }) {
  const arrow = `${detectedSourceLang || '??'} → ${targetLang}${fromCache ? ' · cached' : ''}`;
  return new EmbedBuilder()
    .setTitle('🌐 Translation')
    .setColor(COLORS.brand.info)
    .addFields(
      { name: 'Source', value: truncate(sourceText, 1024) },
      { name: 'Translation', value: truncate(translation, 1024) },
    )
    .setFooter({ text: `${arrow} · ${FOOTER}` });
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function friendlyDeeplError(err) {
  if (!(err instanceof DeeplError)) {
    logger.error('translate: uncaught', err);
    return 'Translation failed. Try again.';
  }
  switch (err.kind) {
    case 'auth':
      logger.error('translate: DeepL auth failed', err);
      return 'Translation service rejected the request. Ask an admin to check the API key.';
    case 'quota':
      logger.warn('translate: DeepL quota exceeded');
      return 'Monthly translation quota reached. Resets on the 1st.';
    case 'timeout':
    case 'upstream':
    case 'network':
      logger.error('translate: DeepL', err.kind, err.message);
      return 'Translation service is down. Try again in a moment.';
    case 'http':
    case 'shape':
    default:
      logger.error('translate: DeepL', err.kind, err.message);
      return 'Translation failed. Try again.';
  }
}
```

- [ ] **Step 6.4: Run tests, verify they pass**

Run: `npm test -- --test-name-pattern="translate slash"`
Expected: all 11 tests PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/handlers/translate.js test/handlers/translate.test.js
git commit -m "feat(translate): slash command handler with cache + rate limit"
```

---

## Task 7: Reaction handler

**Files:**
- Create: `src/handlers/translateReaction.js`
- Create: `test/handlers/translateReaction.test.js`

The reaction handler:
1. Resolves partial reaction/message via `.fetch()`
2. Skips if user is a bot or the emoji is not a supported flag
3. Skips silently if message content is empty
4. Dedup: in-memory set fast path → thread message scan as backstop
5. Rate-limit check (silent on fail)
6. Cache lookup → DeepL call → store
7. Ensure thread (use parent thread, message's existing thread, or create new one)
8. Post embed in thread, add to in-memory dedup

- [ ] **Step 7.1: Write the failing test**

Create `test/handlers/translateReaction.test.js` with:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleTranslateReaction,
  _resetDedup,
} from '../../src/handlers/translateReaction.js';
import { translationCache } from '../../src/utils/translation/cache.js';
import { _resetRateLimit } from '../../src/utils/translation/rateLimit.js';

let originalFetch;
let originalKey;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalKey = process.env.DEEPL_API_KEY;
  process.env.DEEPL_API_KEY = 'test-key';
  _resetRateLimit();
  _resetDedup();
  for (const k of [...translationCache.map.keys()]) translationCache.delete(k);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DEEPL_API_KEY;
  else process.env.DEEPL_API_KEY = originalKey;
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

// ── Test doubles ────────────────────────────────────────────────────────────

function makeThread({ messages = [] } = {}) {
  const sent = [];
  return {
    _sent: sent,
    archived: false,
    isThread: () => true,
    messages: {
      fetch: async () => ({ values: () => messages[Symbol.iterator]() }),
    },
    send: async (payload) => {
      const m = { ...payload, author: { id: 'BOT' } };
      sent.push(m);
      return m;
    },
  };
}

function makeChannel({ isThread = false, parentThread = null, missingPerms = [] } = {}) {
  return {
    isThread: () => isThread,
    permissionsFor: () => ({
      has: (perm) => !missingPerms.includes(perm),
    }),
    // If this channel is itself a thread, expose .send for in-thread replies
    send: parentThread ? parentThread.send : async () => {},
  };
}

function makeMessage({
  id = 'm1', content = 'Hallo Welt', author = { id: 'human', bot: false },
  thread = null, channel = makeChannel(),
  startThreadResult = null,
} = {}) {
  return {
    id,
    content,
    author,
    thread,
    channel,
    partial: false,
    fetch: async function () { return this; },
    startThread: async (opts) => startThreadResult ?? makeThread(),
  };
}

function makeReaction({
  emoji = '🇩🇪', message = makeMessage(), partial = false,
} = {}) {
  return {
    partial,
    emoji: { name: emoji },
    message,
    fetch: async function () { this.partial = false; return this; },
  };
}

function makeUser({ id = 'u1', bot = false } = {}) {
  return { id, bot };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('reaction: bot user reactions are ignored', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const r = makeReaction();
  await handleTranslateReaction(r, makeUser({ bot: true }));
  // no fetch attempted
});

test('reaction: unknown flag is ignored', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const r = makeReaction({ emoji: '👍' });
  await handleTranslateReaction(r, makeUser());
});

test('reaction: empty message content is silently skipped', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const r = makeReaction({ message: makeMessage({ content: '' }) });
  await handleTranslateReaction(r, makeUser());
});

test('reaction: creates a new thread and posts translation when no thread exists', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello world', detected_source_language: 'DE' }],
  });
  const thread = makeThread();
  const msg = makeMessage({ startThreadResult: thread });
  const r = makeReaction({ message: msg });
  await handleTranslateReaction(r, makeUser());
  assert.equal(thread._sent.length, 1);
  const sent = thread._sent[0];
  const embed = sent.embeds[0].data ?? sent.embeds[0];
  assert.ok(JSON.stringify(embed).includes('Hello world'));
});

test('reaction: reuses existing thread on parent message', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello', detected_source_language: 'DE' }],
  });
  const existingThread = makeThread();
  const msg = makeMessage({ thread: existingThread });
  await handleTranslateReaction(makeReaction({ message: msg }), makeUser());
  assert.equal(existingThread._sent.length, 1);
});

test('reaction: when parent message is inside a thread, replies in that thread (no nesting)', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello', detected_source_language: 'DE' }],
  });
  const parentThread = makeThread();
  const channel = makeChannel({ isThread: true, parentThread });
  let startThreadCalled = false;
  const msg = makeMessage({ channel });
  msg.startThread = async () => { startThreadCalled = true; return null; };
  await handleTranslateReaction(makeReaction({ message: msg }), makeUser());
  assert.equal(startThreadCalled, false, 'should not create a nested thread');
  assert.equal(parentThread._sent.length, 1);
});

test('reaction: missing CreatePublicThreads permission → silent exit, no fetch', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const channel = makeChannel({ missingPerms: ['CreatePublicThreads'] });
  const msg = makeMessage({ channel });
  await handleTranslateReaction(makeReaction({ message: msg }), makeUser());
});

test('reaction: in-memory dedup prevents second post in same (msg, lang)', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({
      translations: [{ text: 'Hello', detected_source_language: 'DE' }],
    });
  };
  const thread = makeThread();
  const msg = makeMessage({ id: 'msg-X', thread });
  await handleTranslateReaction(makeReaction({ emoji: '🇬🇧', message: msg }), makeUser({ id: 'u1' }));
  await handleTranslateReaction(makeReaction({ emoji: '🇬🇧', message: msg }), makeUser({ id: 'u2' }));
  assert.equal(thread._sent.length, 1);
  assert.equal(calls, 1, 'cache should also have prevented second API call');
});

test('reaction: thread-scan dedup catches duplicate when in-memory set has been cleared', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello', detected_source_language: 'DE' }],
  });
  // Existing thread already contains a bot translation for EN-GB
  const existingBotMessage = {
    author: { id: 'BOT', bot: true },
    embeds: [{ data: { title: '🇬🇧 EN-GB (from DE)', description: 'Hello' } }],
  };
  const thread = makeThread({ messages: [existingBotMessage] });
  const msg = makeMessage({ thread });
  // Simulate cleared dedup (e.g. after restart)
  _resetDedup();
  await handleTranslateReaction(makeReaction({ emoji: '🇬🇧', message: msg }), makeUser());
  assert.equal(thread._sent.length, 0, 'thread scan should have caught the duplicate');
});

test('reaction: rate limit hit → silent exit, no post', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello', detected_source_language: 'DE' }],
  });
  // Burn rate limit via 10 distinct messages
  for (let n = 0; n < 10; n++) {
    const t = makeThread();
    const m = makeMessage({ id: `m${n}`, thread: t });
    await handleTranslateReaction(makeReaction({ message: m }), makeUser({ id: 'rl-user' }));
  }
  // 11th attempt should silently exit
  const t11 = makeThread();
  const m11 = makeMessage({ id: 'm11', thread: t11 });
  await handleTranslateReaction(makeReaction({ message: m11 }), makeUser({ id: 'rl-user' }));
  assert.equal(t11._sent.length, 0);
});

test('reaction: missing API key → silent exit, no fetch, no post', async () => {
  delete process.env.DEEPL_API_KEY;
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const thread = makeThread();
  const msg = makeMessage({ thread });
  await handleTranslateReaction(makeReaction({ message: msg }), makeUser());
  assert.equal(thread._sent.length, 0);
});

test('reaction: partial reaction is fetched before processing', async () => {
  globalThis.fetch = async () => jsonResponse({
    translations: [{ text: 'Hello', detected_source_language: 'DE' }],
  });
  const thread = makeThread();
  const msg = makeMessage({ thread });
  const r = makeReaction({ message: msg, partial: true });
  let fetched = false;
  r.fetch = async function () { fetched = true; this.partial = false; return this; };
  await handleTranslateReaction(r, makeUser());
  assert.equal(fetched, true);
  assert.equal(thread._sent.length, 1);
});

test('reaction: DeepL error → silent exit, no post', async () => {
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  const thread = makeThread();
  const msg = makeMessage({ thread });
  await handleTranslateReaction(makeReaction({ message: msg }), makeUser());
  assert.equal(thread._sent.length, 0);
});

test('reaction: oversize content → silent exit', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  const thread = makeThread();
  const msg = makeMessage({ content: 'x'.repeat(5001), thread });
  await handleTranslateReaction(makeReaction({ message: msg }), makeUser());
  assert.equal(thread._sent.length, 0);
});

test('reaction: cache hit reuses translation across two different messages with same text', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({
      translations: [{ text: 'Hello', detected_source_language: 'DE' }],
    });
  };
  const t1 = makeThread();
  const m1 = makeMessage({ id: 'msg-1', content: 'Hallo', thread: t1 });
  const t2 = makeThread();
  const m2 = makeMessage({ id: 'msg-2', content: 'Hallo', thread: t2 });
  await handleTranslateReaction(makeReaction({ message: m1 }), makeUser({ id: 'a' }));
  await handleTranslateReaction(makeReaction({ message: m2 }), makeUser({ id: 'b' }));
  assert.equal(calls, 1);
  assert.equal(t1._sent.length, 1);
  assert.equal(t2._sent.length, 1);
});
```

- [ ] **Step 7.2: Run test, verify it fails**

Run: `npm test -- --test-name-pattern="reaction:"`
Expected: tests FAIL with `Cannot find module '.../translateReaction.js'`.

- [ ] **Step 7.3: Create the handler**

Create `src/handlers/translateReaction.js` with:

```js
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { translate, DeeplError } from '../utils/translation/deepl.js';
import { translationCache } from '../utils/translation/cache.js';
import { checkRateLimit } from '../utils/translation/rateLimit.js';
import { flagToDeepl } from '../utils/translation/locales.js';

const MAX_CHARS = 5000;
const THREAD_NAME = '🌐 Translations';
const THREAD_ARCHIVE_MIN = 60; // Discord values: 60/1440/4320/10080. 1h closest to spec target.
const DEDUP_CAP = 1000;
const THREAD_SCAN_LIMIT = 100;

// In-memory dedup. `${messageId}:${targetLang}` keys.
// FIFO eviction; capped at DEDUP_CAP entries.
const dedupSet = new Set();
const dedupOrder = [];

function dedupHas(key) {
  return dedupSet.has(key);
}

function dedupAdd(key) {
  if (dedupSet.has(key)) return;
  dedupSet.add(key);
  dedupOrder.push(key);
  while (dedupOrder.length > DEDUP_CAP) {
    const old = dedupOrder.shift();
    dedupSet.delete(old);
  }
}

// Test-only helper.
export function _resetDedup() {
  dedupSet.clear();
  dedupOrder.length = 0;
}

export async function handleTranslateReaction(reaction, user) {
  if (user?.bot) return;

  // 1. Map flag → target lang (cheapest filter first)
  const emoji = reaction?.emoji?.name;
  const targetLang = flagToDeepl(emoji);
  if (!targetLang) return;

  // 2. API key present?
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return;

  // 3. Resolve partial reaction / message
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message?.partial) await reaction.message.fetch();
  } catch (err) {
    logger.warn('translateReaction: failed to fetch partial', err.message);
    return;
  }

  const message = reaction.message;
  const rawText = message?.content ?? '';
  const text = rawText.trim();
  if (!text) return;
  if (text.length > MAX_CHARS) return;

  // 4. In-memory dedup fast path
  const dedupKey = `${message.id}:${targetLang}`;
  if (dedupHas(dedupKey)) return;

  // 5. Permission check (only meaningful for non-thread channels)
  const channel = message.channel;
  if (channel && typeof channel.permissionsFor === 'function') {
    const me = channel.guild?.members?.me ?? null;
    const perms = channel.permissionsFor(me);
    if (perms) {
      const needsCreate = !channel.isThread();
      if (needsCreate && !perms.has(PermissionFlagsBits.CreatePublicThreads)) {
        logger.warn('translateReaction: missing CreatePublicThreads in channel', channel.id);
        return;
      }
      if (!perms.has(PermissionFlagsBits.SendMessagesInThreads)) {
        logger.warn('translateReaction: missing SendMessagesInThreads in channel', channel.id);
        return;
      }
    }
  }

  // 6. Locate or create the target thread
  let thread;
  try {
    thread = await resolveThread(message);
  } catch (err) {
    logger.warn('translateReaction: thread resolution failed', err.message);
    return;
  }
  if (!thread) return;

  // 7. Thread-scan dedup backstop
  try {
    const existing = await scanThreadForExisting(thread, targetLang);
    if (existing) {
      dedupAdd(dedupKey);
      return;
    }
  } catch (err) {
    logger.warn('translateReaction: thread scan failed (continuing)', err.message);
  }

  // 8. Rate limit
  const rl = checkRateLimit(user.id);
  if (!rl.allowed) {
    logger.debug('translateReaction: rate limit', user.id);
    return;
  }

  // 9. Cache lookup → translate
  const cacheKey = `${targetLang}:${text}`;
  let result = translationCache.get(cacheKey);
  const fromCache = !!result;
  if (!result) {
    try {
      result = await translate({ text, targetLang, apiKey });
    } catch (err) {
      if (err instanceof DeeplError) {
        logger.warn('translateReaction: DeepL', err.kind, err.message);
      } else {
        logger.error('translateReaction: uncaught', err);
      }
      return;
    }
    translationCache.set(cacheKey, result);
  }

  // 10. Post embed
  const embed = buildReactionEmbed({
    emoji,
    targetLang,
    detectedSourceLang: result.detectedSourceLang,
    translation: result.translation,
    triggeredBy: user,
    fromCache,
  });

  try {
    await thread.send({ embeds: [embed] });
    dedupAdd(dedupKey);
  } catch (err) {
    logger.warn('translateReaction: thread.send failed', err.message);
  }
}

async function resolveThread(message) {
  // Case A: the reacted-to message is already inside a thread
  if (message.channel?.isThread?.()) {
    return message.channel;
  }
  // Case B: the message has its own thread attached
  if (message.thread) return message.thread;
  // Case C: create a new thread on the message
  return message.startThread({
    name: THREAD_NAME,
    autoArchiveDuration: THREAD_ARCHIVE_MIN,
  });
}

async function scanThreadForExisting(thread, targetLang) {
  const fetched = await thread.messages.fetch({ limit: THREAD_SCAN_LIMIT });
  for (const m of fetched.values()) {
    const embed = m.embeds?.[0];
    const title = embed?.data?.title ?? embed?.title;
    if (typeof title === 'string' && title.includes(targetLang)) {
      return true;
    }
  }
  return false;
}

function buildReactionEmbed({ emoji, targetLang, detectedSourceLang, translation, triggeredBy, fromCache }) {
  const src = detectedSourceLang || '??';
  const title = `${emoji} ${targetLang} (from ${src})`;
  const triggerLine = `Triggered by <@${triggeredBy.id}>${fromCache ? ' · cached' : ''}`;
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(COLORS.brand.info)
    .setDescription(truncate(translation, 4000))
    .setFooter({ text: `${triggerLine} · ${FOOTER}` });
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
```

- [ ] **Step 7.4: Run tests, verify they pass**

Run: `npm test -- --test-name-pattern="reaction:"`
Expected: all 15 tests PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/handlers/translateReaction.js test/handlers/translateReaction.test.js
git commit -m "feat(translate): reaction handler with thread + two-layer dedup"
```

---

## Task 8: Wire `/translate` into router

**Files:**
- Modify: `src/handlers/router.js`

- [ ] **Step 8.1: Add import**

In `src/handlers/router.js`, add this import near the other handler imports (after the `handleHelpCommand` import is fine):

```js
import { handleTranslate } from './translate.js';
```

- [ ] **Step 8.2: Add the dispatch branch**

In the `switch (interaction.commandName)` block inside `routeCommand` (around line 88-105), add a new case before the `default:` clause:

```js
      case 'translate':   return await handleTranslate(interaction);
```

The final segment of `routeCommand` should now look like:

```js
      case 'leaderboard': return await handleLeaderboardCommand(interaction);
      case 'timer':       return await handleTimerCommand(interaction);
      case 'help':        return await handleHelpCommand(interaction);
      case 'translate':   return await handleTranslate(interaction);
      default:
        return await interaction.reply({ content: 'Unknown command.', ephemeral: true });
```

- [ ] **Step 8.3: Sanity-check the module loads**

Run: `node -e "import('./src/handlers/router.js').then(() => console.log('ok'))"`
Expected: `ok`

- [ ] **Step 8.4: Re-run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: all tests from Tasks 1-7 still pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/handlers/router.js
git commit -m "feat(translate): route /translate to slash handler"
```

---

## Task 9: Wire reaction listener and add intents

**Files:**
- Modify: `src/index.js`

- [ ] **Step 9.1: Update intents**

In `src/index.js` line 27-29, the current `Client` construction is:

```js
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
```

Replace with:

```js
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});
```

`GuildMessages` + `MessageContent` are needed to read the original message content. `GuildMessageReactions` is needed to receive the event. `Partials` lets discord.js deliver `messageReactionAdd` for messages that aren't in the bot's cache (older messages, post-restart). The handler calls `.fetch()` to materialize partials.

- [ ] **Step 9.2: Update the discord.js import**

In `src/index.js` line 6, the current import is:

```js
import { Client, GatewayIntentBits, InteractionType, Events } from 'discord.js';
```

Replace with:

```js
import { Client, GatewayIntentBits, InteractionType, Events, Partials } from 'discord.js';
```

- [ ] **Step 9.3: Add the reaction handler import**

Near the other handler imports in `src/index.js` (around line 17-20), add:

```js
import { handleTranslateReaction } from './handlers/translateReaction.js';
```

- [ ] **Step 9.4: Add the event listener**

In `src/index.js`, after the existing `client.on(Events.GuildMemberRemove, ...)` block (around line 108), append:

```js
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleTranslateReaction(reaction, user);
  } catch (err) {
    logger.error('messageReactionAdd handler crashed:', err);
    recordError(err);
  }
});
```

- [ ] **Step 9.5: Add startup warning if API key is missing**

In `src/index.js`, inside the `client.once('clientReady', ...)` block (around line 31), add this line right after the `logger.info(`Logged in as ${client.user.tag}`)`:

```js
  if (!process.env.DEEPL_API_KEY) {
    logger.warn('DEEPL_API_KEY not set — /translate and flag-reaction translation will be disabled');
  }
```

- [ ] **Step 9.6: Sanity-check the bot module still loads**

Run: `node -e "import('discord.js').then(d => { const c = new d.Client({ intents: [d.GatewayIntentBits.Guilds, d.GatewayIntentBits.GuildMembers, d.GatewayIntentBits.GuildMessages, d.GatewayIntentBits.GuildMessageReactions, d.GatewayIntentBits.MessageContent], partials: [d.Partials.Message, d.Partials.Channel, d.Partials.Reaction] }); console.log('ok'); c.destroy(); })"`
Expected: `ok`. (Confirms the intent and partial values are valid for the installed discord.js version.)

- [ ] **Step 9.7: Re-run the full test suite**

Run: `npm test`
Expected: all tests from Tasks 1-7 still pass. (index.js itself is not unit-tested — its wiring is exercised end-to-end at deploy time.)

- [ ] **Step 9.8: Commit**

```bash
git add src/index.js
git commit -m "feat(translate): add reaction listener + intents + startup check"
```

---

## Task 10: Deploy and manually smoke-test

This task is **manual**, with no code or commits. It verifies the end-to-end flow against Discord.

- [ ] **Step 10.1: Enable the `MessageContent` privileged intent**

Open the [Discord Developer Portal](https://discord.com/developers/applications), select the bot's application → **Bot** → **Privileged Gateway Intents** → toggle **MESSAGE CONTENT INTENT** on. Save.

If this isn't enabled, the bot will start but `reaction.message.content` will always be empty for messages it didn't send — flag reactions will appear to do nothing.

- [ ] **Step 10.2: Get a DeepL Free API key**

Sign up at [deepl.com/pro-api](https://www.deepl.com/pro-api) (Free plan). Copy the key.

- [ ] **Step 10.3: Add `DEEPL_API_KEY` to the bot's environment**

In the bot's `.env`:

```
DEEPL_API_KEY=your-deepl-free-key-here:fx
```

(DeepL Free keys end with `:fx`.)

- [ ] **Step 10.4: Re-register slash commands**

Run: `npm run deploy-commands`
Expected: `Registering slash commands...` then `Done.`

- [ ] **Step 10.5: Start the bot**

Run: `npm start`
Expected log lines:
- `Logged in as <BotName>`
- No warning about `DEEPL_API_KEY not set`

- [ ] **Step 10.6: Test the slash command**

In a Discord channel where the bot has access:

1. Type `/translate text:Hallo Welt` → expect ephemeral embed with English translation, footer `DE → EN-GB` (or your locale)
2. Type `/translate text:Hello to:FR` → expect ephemeral embed with French, footer `EN → FR`
3. Run `/translate text:Hallo Welt` again → expect ` · cached` in footer (hit on second run)
4. Run `/translate text:` (empty) → expect `Nothing to translate.`

- [ ] **Step 10.7: Test reaction translation**

1. Post a non-English message in a channel where the bot can create threads (e.g. `Привет всем`)
2. React with 🇬🇧 → expect a new thread `🌐 Translations` to appear, containing a bot embed with the English translation
3. From another account (or use a second flag — 🇩🇪) react again → expect either:
   - Same flag: no new post (dedup), no thread spam
   - Different flag: another embed appears in the same thread
4. Wait 1h → thread auto-archives (collapses in sidebar)
5. React with 🇫🇷 to the same message → expect the thread auto-unarchives and a new embed appears

- [ ] **Step 10.8: Verify failure modes**

1. Temporarily set `DEEPL_API_KEY=` (empty) and restart
2. `/translate text:Hello` → expect `Translation isn't configured...` reply
3. React 🇬🇧 to any message → expect silent no-op (nothing in channel, `warn` in logs)
4. Restore the real key and restart

If any of these don't behave as expected, file the discrepancy and re-check the relevant handler logic.

---

## Self-review

After writing the plan, checked against the spec:

**Spec coverage:**
- ✅ User-facing surface (slash + reaction): Tasks 5, 6, 7
- ✅ Supported languages + flag map: Task 1
- ✅ Locale resolution: Task 1 (data) + Task 6 (orchestration)
- ✅ Slash reply format: Task 6 (buildSlashEmbed)
- ✅ Reaction reply format: Task 7 (buildReactionEmbed)
- ✅ Architecture / module responsibilities: Tasks 1-4 (utils) + 6-7 (handlers)
- ✅ Configuration / API key handling: Task 6 + 7 + Task 9 (startup warn)
- ✅ Discord intents and permissions: Task 9
- ✅ Reaction listener wiring: Task 9
- ✅ Slash routing: Task 8
- ✅ Slash command registration: Task 5
- ✅ Caching: Task 2 + integrated in Tasks 6/7
- ✅ Dedup (in-memory + thread scan): Task 7
- ✅ Rate limiting (shared): Task 4 + integrated in Tasks 6/7
- ✅ Threads (creation, reuse, in-thread reactions, auto-archive): Task 7
- ✅ Data flow: Tasks 6, 7
- ✅ Error handling matrix: Task 6 (friendlyDeeplError) + Task 7 (silent fail)
- ✅ DeepL provider: Task 3
- ✅ Testing: every module has a paired test task

**Placeholder scan:** no TBD / TODO / "similar to above" / vague "handle edge cases".

**Type consistency:**
- `handleTranslate(interaction)` — used in Tasks 6, 8 ✓
- `handleTranslateReaction(reaction, user)` — used in Tasks 7, 9 ✓
- `translationCache.get/set/has/delete` — used in Tasks 2, 6, 7 ✓
- `checkRateLimit(userId)`, `_resetRateLimit()` — used in Tasks 4, 6, 7 ✓
- `_resetDedup()` — used in Task 7 ✓
- `flagToDeepl(emoji)`, `discordLocaleToDeepl(locale)`, `FALLBACK_LANG`, `SUPPORTED_LANGS`, `langChoices()` — used in Tasks 1, 6, 7 ✓
- `translate({ text, targetLang, apiKey, timeoutMs })`, `DeeplError` (with `kind`, `status`) — used in Tasks 3, 6, 7 ✓

No drift between definitions and call sites.
