import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeadline, formatDeadline } from '../src/utils/time.js';

test('parseDeadline: YYYY-MM-DD HH:MM:SS is UTC-correct', () => {
  const got = parseDeadline('2030-06-01 10:00:01');
  const want = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(got, want);
});

test('parseDeadline: ISO 8601 with Z', () => {
  const got = parseDeadline('2030-06-01T10:00:01Z');
  const want = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(got, want);
});

test('parseDeadline: ISO 8601 with explicit +03:00 offset', () => {
  const got = parseDeadline('2030-06-01T13:00:01+03:00');
  const want = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(got, want);
});

test('parseDeadline: bare unix seconds passes through', () => {
  assert.equal(parseDeadline('1900000000'), 1_900_000_000);
});

test('parseDeadline: Discord <t:N:T> tag extracts unix seconds', () => {
  assert.equal(parseDeadline('<t:1900000000:T>'), 1_900_000_000);
  assert.equal(parseDeadline('<t:1900000000>'), 1_900_000_000);
});

test('parseDeadline: relative "in 2h30m"', () => {
  const before = Math.floor(Date.now() / 1000);
  const got = parseDeadline('in 2h30m');
  const after = Math.floor(Date.now() / 1000);
  assert.ok(got >= before + 2 * 3600 + 30 * 60 - 1, `got=${got}, lower=${before + 9000}`);
  assert.ok(got <= after + 2 * 3600 + 30 * 60 + 2, `got=${got}, upper=${after + 9001}`);
});

test('parseDeadline: relative "+2h" is alias for "in 2h"', () => {
  const before = Math.floor(Date.now() / 1000);
  const got = parseDeadline('+2h');
  const after = Math.floor(Date.now() / 1000);
  assert.ok(got >= before + 2 * 3600 - 1);
  assert.ok(got <= after + 2 * 3600 + 2);
});

test('parseDeadline: natural-language "tomorrow 14:30" is UTC', () => {
  const got = parseDeadline('tomorrow 14:30');
  const refUtc = new Date();
  const tomorrowUtc = Date.UTC(refUtc.getUTCFullYear(), refUtc.getUTCMonth(), refUtc.getUTCDate() + 1, 14, 30, 0) / 1000;
  assert.equal(got, tomorrowUtc);
});

test('parseDeadline: empty/whitespace returns null', () => {
  assert.equal(parseDeadline(''), null);
  assert.equal(parseDeadline('   '), null);
  assert.equal(parseDeadline(null), null);
});

test('parseDeadline: completely unparseable returns null', () => {
  assert.equal(parseDeadline('xyzzy not a date'), null);
});

test('formatDeadline: emits UTC components', () => {
  const unix = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(formatDeadline(unix), '2030-06-01 10:00:01');
});

test('formatDeadline: round-trips with parseDeadline', () => {
  const input = '2030-06-01 10:00:01';
  assert.equal(formatDeadline(parseDeadline(input)), input);
});

test('formatDeadline(0/null) returns empty string', () => {
  assert.equal(formatDeadline(0), '');
  assert.equal(formatDeadline(null), '');
});

test('parseDeadline: 9-digit (pre-2001) number is NOT treated as unix seconds', () => {
  // 9 digits would be pre-Sept 2001. parseDeadline routes these to chrono,
  // which returns null for a bare integer with no date-ish context.
  assert.equal(parseDeadline('123456789'), null);
});

test('parseDeadline: 10-digit unix seconds boundary', () => {
  // 1000000000 → 2001-09-09T01:46:40Z — the first 10-digit unix.
  assert.equal(parseDeadline('1000000000'), 1_000_000_000);
});

import { routeAutocomplete } from '../src/handlers/router.js';

test('routeAutocomplete: /active-def arrival returns time-offset suggestions', async () => {
  const responded = [];
  const interaction = {
    isAutocomplete: () => true,
    commandName: 'active-def',
    options: { getFocused: () => '' },
    respond: async (choices) => { responded.push(choices); },
  };
  await routeAutocomplete(interaction);
  assert.equal(responded.length, 1);
  const choices = responded[0];
  assert.ok(choices.length > 0, 'expected suggestions');
  assert.ok(choices.length <= 25, 'expected ≤25 suggestions');
  for (const c of choices) {
    assert.ok(typeof c.name === 'string' && c.name.length <= 100);
    assert.ok(typeof c.value === 'string');
    assert.match(c.value, /^in /);
  }
});

test('routeAutocomplete: filters by focused substring', async () => {
  const responded = [];
  const interaction = {
    isAutocomplete: () => true,
    commandName: 'active-def',
    options: { getFocused: () => '24' },
    respond: async (choices) => { responded.push(choices); },
  };
  await routeAutocomplete(interaction);
  const choices = responded[0];
  assert.ok(choices.length >= 1);
  assert.ok(choices.every(c => c.name.toLowerCase().includes('24')));
});
