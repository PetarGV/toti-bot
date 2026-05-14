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

test('translate parses successful response', async () => {
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

test('translate sends Authorization header and url-encoded body', async () => {
  let capturedUrl;
  let capturedOpts;
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
  assert.equal(capturedOpts.headers.Authorization, 'DeepL-Auth-Key KEY-123');
  assert.equal(capturedOpts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = capturedOpts.body.toString();
  assert.ok(body.includes('text=hi'));
  assert.ok(body.includes('target_lang=DE'));
});

test('translate maps 403 to auth error', async () => {
  mockFetch(async () => new Response('forbidden', { status: 403 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'bad' }),
    (err) => err instanceof DeeplError && err.kind === 'auth' && err.status === 403,
  );
});

test('translate maps 456 to quota error', async () => {
  mockFetch(async () => new Response('quota', { status: 456 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'quota' && err.status === 456,
  );
});

test('translate maps 5xx to upstream error', async () => {
  mockFetch(async () => new Response('boom', { status: 500 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'upstream' && err.status === 500,
  );
});

test('translate maps other non-2xx responses to http error', async () => {
  mockFetch(async () => new Response('bad', { status: 400 }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'http' && err.status === 400,
  );
});

test('translate maps aborts/timeouts to timeout error', async () => {
  globalThis.fetch = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };

  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'timeout',
  );
});

test('translate maps network errors to network error', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'network',
  );
});

test('translate maps unexpected response shape to shape error', async () => {
  mockFetch(async () => jsonResponse(200, { notTranslations: [] }));
  await assert.rejects(
    translate({ text: 'x', targetLang: 'DE', apiKey: 'k' }),
    (err) => err instanceof DeeplError && err.kind === 'shape',
  );
});
