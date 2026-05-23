import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOUT_CATEGORY_NAME,
  SCOUT_REPORTS_CHANNEL_NAME,
  REPORT_UPLOAD_WINDOW_SEC,
  TEMP_CHANNEL_DELETE_DELAY_SEC,
  buildScoutChannelName,
  generateScoutCode,
  parseScoutCommitmentAmount,
  isValidScoutImageAttachment,
} from '../src/utils/scoutReports.js';

test('scout report constants match approved channel workflow', () => {
  assert.equal(SCOUT_CATEGORY_NAME, 'Scouting');
  assert.equal(SCOUT_REPORTS_CHANNEL_NAME, 'scout-reports');
  assert.equal(REPORT_UPLOAD_WINDOW_SEC, 600);
  assert.equal(TEMP_CHANNEL_DELETE_DELAY_SEC, 86400);
});

test('generateScoutCode returns four lowercase alphanumeric characters', () => {
  const code = generateScoutCode(() => 0.5);
  assert.match(code, /^[a-z0-9]{4}$/);
});

test('buildScoutChannelName keeps negative coordinates unambiguous', () => {
  assert.equal(
    buildScoutChannelName({ code: 'a3f9', x: -50, y: 72, player: 'Enemy Name' }),
    'scout-a3f9-x-50-y72-enemy-name',
  );
  assert.equal(
    buildScoutChannelName({ code: 'k8q2', x: 35, y: -88, player: null }),
    'scout-k8q2-x35-y-88-unknown',
  );
});

test('buildScoutChannelName strips unsafe characters and truncates long names', () => {
  const name = buildScoutChannelName({
    code: 'z9z9',
    x: 1,
    y: 2,
    player: 'Very Long ./ Player_Name That Should Be Truncated After A Reasonable Point',
  });

  assert.match(name, /^scout-z9z9-x1-y2-very-long-player-name-that-should-be/);
  assert.ok(name.length <= 90);
  assert.doesNotMatch(name, /[ ./_]/);
});

test('parseScoutCommitmentAmount returns numeric commitments only', () => {
  assert.equal(parseScoutCommitmentAmount('50'), 50);
  assert.equal(parseScoutCommitmentAmount(' 500+ '), 500);
  assert.equal(parseScoutCommitmentAmount('1,250 scouts'), 1250);
  assert.equal(parseScoutCommitmentAmount('On it'), null);
  assert.equal(parseScoutCommitmentAmount(''), null);
});

test('isValidScoutImageAttachment accepts known image attachments', () => {
  assert.equal(isValidScoutImageAttachment({ contentType: 'image/png', name: 'report.txt' }), true);
  assert.equal(isValidScoutImageAttachment({ contentType: null, name: 'report.webp' }), true);
  assert.equal(isValidScoutImageAttachment({ contentType: 'text/plain', name: 'report.png' }), true);
  assert.equal(isValidScoutImageAttachment({ contentType: 'application/pdf', name: 'report.pdf' }), false);
  assert.equal(isValidScoutImageAttachment({ contentType: null, name: null }), false);
});
