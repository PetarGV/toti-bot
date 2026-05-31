import test from 'node:test';
import assert from 'node:assert/strict';
import { chebyshev, defValue, avgWaveGapSec } from '../src/utils/defMath.js';

test('chebyshev: same point = 0', () => assert.equal(chebyshev({x:0,y:0},{x:0,y:0}), 0));
test('chebyshev: (0,0) to (3,4) = 4', () => assert.equal(chebyshev({x:0,y:0},{x:3,y:4}), 4));
test('chebyshev: negative coords', () => assert.equal(chebyshev({x:-12,y:34},{x:-15,y:30}), 4));

test('defValue: inf+2*cav', () => {
  assert.equal(defValue(0, 0), 0);
  assert.equal(defValue(1000, 500), 2000);
  assert.equal(defValue(0, 1500), 3000);
});

test('avgWaveGapSec returns spread/(waves-1)', () => {
  assert.equal(avgWaveGapSec(6, 4), 2);
  assert.equal(avgWaveGapSec(1, 4), 1/3);
});
test('avgWaveGapSec returns null for 1 wave or null spread', () => {
  assert.equal(avgWaveGapSec(null, 4), null);
  assert.equal(avgWaveGapSec(6, 1), null);
  assert.equal(avgWaveGapSec(6, 0), null);
});
