import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyThreat } from '../src/handlers/threat.js';

const T = { chiefMinWaves: 4, chiefTimingSec: 30, focusWindowHrs: 6, scatterRadius: 5, realMinWaves: 2 };

test('chief: waves >= chiefMinWaves', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 4 };
  assert.equal(classifyThreat(r, [], T), 'chief');
});

test('chief by cascade: 3 related reports against same defender exist', () => {
  const r = { id: 4, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  const related = [
    { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 990, waves: 1 },
    { id: 2, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1005, waves: 1 },
    { id: 3, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1020, waves: 1 },
  ];
  assert.equal(classifyThreat(r, related, T), 'chief');
});

test('real: waves >= realMinWaves but < chiefMinWaves', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 2 };
  assert.equal(classifyThreat(r, [], T), 'real');
});

test('fake: single wave with scattered same-attacker defenders in focus window', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  const others = [
    // same attacker, different defender far away (> scatter radius 5)
    { id: 2, attacker_x: 0, attacker_y: 0, defender_x: 100, defender_y: 100, first_eta: 1000, waves: 1 },
  ];
  assert.equal(classifyThreat(r, others, T), 'fake');
});

test('real: single wave focused (no scattered defenders in window)', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  assert.equal(classifyThreat(r, [], T), 'real');
});

test('real: single wave + same attacker hitting nearby defender (within radius) = focused', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  const others = [
    { id: 2, attacker_x: 0, attacker_y: 0, defender_x: 3, defender_y: 3, first_eta: 1100, waves: 1 },
  ];
  assert.equal(classifyThreat(r, others, T), 'real');
});
