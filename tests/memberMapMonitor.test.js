import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemberMapAudit,
  matchMemberToPlayer,
  normalizeNameForMatch,
} from '../src/utils/memberMapMonitor.js';

const players = [
  { uid: 10, player: 'Lord Vader', villages: 3, population: 1200 },
  { uid: 11, player: 'Annie-Case', villages: 1, population: 420 },
  { uid: 12, player: 'Case', villages: 2, population: 600 },
  { uid: 13, player: 'Miro', villages: 4, population: 1300 },
];

test('normalizeNameForMatch lowercases names and strips symbols', () => {
  assert.equal(normalizeNameForMatch(' [ALLY] Lord_Vader#123 '), 'allylordvader123');
  assert.equal(normalizeNameForMatch('Annie.Case | DEF'), 'anniecasedef');
  assert.equal(normalizeNameForMatch('M\u00edr\u00f3\u2605'), 'miro');
  assert.equal(normalizeNameForMatch(null), '');
});

test('matchMemberToPlayer matches Travian names inside Discord display names', () => {
  const result = matchMemberToPlayer({ displayName: '[ALLY] lord.vader | DEF' }, players);

  assert.equal(result.status, 'matched');
  assert.equal(result.player.player, 'Lord Vader');
});

test('matchMemberToPlayer prefers the longest normalized player name', () => {
  const result = matchMemberToPlayer({ displayName: 'AnnieCase' }, players);

  assert.equal(result.status, 'matched');
  assert.equal(result.player.player, 'Annie-Case');
});

test('matchMemberToPlayer reports ambiguous equal-length matches', () => {
  const result = matchMemberToPlayer(
    { displayName: 'AlphaGamma' },
    [
      { uid: 21, player: 'Alpha', villages: 1, population: 100 },
      { uid: 22, player: 'Gamma', villages: 1, population: 100 },
    ],
  );

  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.players.map((player) => player.player), ['Alpha', 'Gamma']);
});

test('buildMemberMapAudit separates matched, unmatched, and ambiguous members', () => {
  const audit = buildMemberMapAudit(
    [
      { id: '1', displayName: '[ALLY] Lord Vader' },
      { id: '2', displayName: 'AlphaGamma' },
      { id: '3', displayName: 'Unknown' },
    ],
    [
      ...players,
      { uid: 21, player: 'Alpha', villages: 1, population: 100 },
      { uid: 22, player: 'Gamma', villages: 1, population: 100 },
    ],
  );

  assert.equal(audit.matched.length, 1);
  assert.equal(audit.ambiguous.length, 1);
  assert.equal(audit.unmatched.length, 1);
  assert.equal(audit.matched[0].member.id, '1');
  assert.equal(audit.ambiguous[0].member.id, '2');
  assert.equal(audit.unmatched[0].member.id, '3');
});
