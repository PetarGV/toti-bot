import test from 'node:test';
import assert from 'node:assert/strict';
import { rankHotTargets, focusOrScatter } from '../src/handlers/intel.js';

test('rankHotTargets: chief count weights higher than report count', () => {
  const rows = [
    { defender_x: 1, defender_y: 1, threat_class: 'real' },
    { defender_x: 1, defender_y: 1, threat_class: 'chief' },
    { defender_x: 2, defender_y: 2, threat_class: 'real' },
    { defender_x: 2, defender_y: 2, threat_class: 'real' },
    { defender_x: 2, defender_y: 2, threat_class: 'real' },
  ];

  const out = rankHotTargets(rows);

  assert.equal(out[0].defender_x, 1);
  assert.equal(out[0].score, 9);
  assert.equal(out[1].defender_x, 2);
});

test('focusOrScatter: all defenders within radius returns focused', () => {
  const defs = [{ x: 0, y: 0 }, { x: 3, y: 3 }];
  assert.equal(focusOrScatter(defs, 5), 'focused');
});

test('focusOrScatter: any pair beyond radius returns scattered', () => {
  const defs = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  assert.equal(focusOrScatter(defs, 5), 'scattered');
});
