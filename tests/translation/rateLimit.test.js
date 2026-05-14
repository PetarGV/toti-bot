import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, _resetRateLimit } from '../../src/utils/translation/rateLimit.js';

test('checkRateLimit allows the first ten calls in the window', () => {
  _resetRateLimit();
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(checkRateLimit('u1', { now: 1000 }), { allowed: true, retryAfterSec: 0 });
  }
});

test('checkRateLimit rejects the eleventh call and reports retry seconds', () => {
  _resetRateLimit();
  for (let i = 0; i < 10; i++) {
    checkRateLimit('u1', { now: 1000 });
  }
  assert.deepEqual(checkRateLimit('u1', { now: 1000 }), { allowed: false, retryAfterSec: 60 });
});

test('checkRateLimit uses a sliding sixty-second window', () => {
  _resetRateLimit();
  for (let i = 0; i < 10; i++) {
    checkRateLimit('u1', { now: 1000 });
  }
  assert.deepEqual(checkRateLimit('u1', { now: 60999 }), { allowed: false, retryAfterSec: 1 });
  assert.deepEqual(checkRateLimit('u1', { now: 61000 }), { allowed: true, retryAfterSec: 0 });
});

test('checkRateLimit tracks users separately', () => {
  _resetRateLimit();
  for (let i = 0; i < 10; i++) {
    checkRateLimit('u1', { now: 1000 });
  }
  assert.equal(checkRateLimit('u2', { now: 1000 }).allowed, true);
});
