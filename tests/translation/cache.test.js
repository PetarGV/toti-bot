import test from 'node:test';
import assert from 'node:assert/strict';
import { LruCache, translationCache, cacheKeyFor } from '../../src/utils/translation/cache.js';

test('LruCache returns undefined for missing key', () => {
  const cache = new LruCache(3);
  assert.equal(cache.get('nope'), undefined);
  assert.equal(cache.has('nope'), false);
});

test('LruCache stores and retrieves values', () => {
  const cache = new LruCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.size(), 2);
});

test('LruCache evicts oldest entry when capacity is exceeded', () => {
  const cache = new LruCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.set('d', 4);
  assert.equal(cache.has('a'), false);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.get('d'), 4);
  assert.equal(cache.size(), 3);
});

test('LruCache get moves entry to most recently used', () => {
  const cache = new LruCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.get('a');
  cache.set('d', 4);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.has('d'), true);
});

test('LruCache set on existing key moves it to most recently used', () => {
  const cache = new LruCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.set('a', 99);
  cache.set('d', 4);
  assert.equal(cache.get('a'), 99);
  assert.equal(cache.has('b'), false);
});

test('translationCache is bounded to 500 entries', () => {
  translationCache.clear();
  assert.ok(translationCache instanceof LruCache);
  for (let i = 0; i < 600; i++) translationCache.set(`fill-${i}`, i);
  assert.equal(translationCache.size(), 500);
  translationCache.clear();
});

test('cacheKeyFor combines target language and source text', () => {
  assert.equal(cacheKeyFor('DE', 'Hallo'), 'DE:Hallo');
});
