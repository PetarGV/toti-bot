import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import {
  cleanupDueScoutReportChannels,
  selectDueScoutReportChannels,
} from '../../src/jobs/scoutReportCleanup.js';

function insertScoutReport(overrides = {}) {
  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, message_id, channel_id, status, payload)
    VALUES ('scout', ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    overrides.authorId ?? 'requester-1',
    overrides.x ?? -50,
    overrides.y ?? 72,
    overrides.messageId ?? `message-${overrides.tempChannelId ?? 'temp-channel'}`,
    overrides.callChannelId ?? 'source-channel',
    overrides.status ?? 'open',
    JSON.stringify(overrides.payload ?? {}),
  );

  const callId = result.lastInsertRowid;
  prepare(`
    INSERT INTO scout_reports (
      call_id,
      scout_code,
      temp_channel_id,
      reported_at,
      delete_after,
      temp_deleted_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    callId,
    overrides.scoutCode ?? `code-${callId}`,
    overrides.tempChannelId ?? `temp-channel-${callId}`,
    overrides.reportedAt ?? null,
    overrides.deleteAfter ?? null,
    overrides.tempDeletedAt ?? null,
  );

  return callId;
}

function fakeClient({ channelsById = {}, fetchErrorById = {} } = {}) {
  const calls = [];
  return {
    channels: {
      async fetch(channelId) {
        calls.push(['fetch', channelId]);
        const fetchError = fetchErrorById[channelId];
        if (fetchError) throw fetchError;
        return channelsById[channelId] ?? null;
      },
    },
    _calls: calls,
  };
}

await setupTestDb();

beforeEach(() => {
  resetTables();
});

test('selectDueScoutReportChannels returns only reported undeleted channels due by now', () => {
  const now = 1_700_000_000;
  const dueCallId = insertScoutReport({
    tempChannelId: 'due-channel',
    reportedAt: now - 100,
    deleteAfter: now,
  });
  insertScoutReport({
    tempChannelId: 'future-channel',
    reportedAt: now - 100,
    deleteAfter: now + 1,
  });
  insertScoutReport({
    tempChannelId: 'unreported-channel',
    reportedAt: null,
    deleteAfter: now - 1,
  });
  insertScoutReport({
    tempChannelId: 'already-deleted-channel',
    reportedAt: now - 100,
    deleteAfter: now - 1,
    tempDeletedAt: now - 10,
  });
  insertScoutReport({
    tempChannelId: 'no-delete-after-channel',
    reportedAt: now - 100,
    deleteAfter: null,
  });

  const rows = selectDueScoutReportChannels(now);

  assert.deepEqual(rows.map(row => row.call_id), [dueCallId]);
  assert.equal(rows[0].temp_channel_id, 'due-channel');
});

test('cleanupDueScoutReportChannels deletes due temp channel and marks it deleted', async () => {
  const now = 1_700_000_000;
  const callId = insertScoutReport({
    tempChannelId: 'due-channel',
    reportedAt: now - 100,
    deleteAfter: now - 1,
  });
  const deleteCalls = [];
  const channel = {
    async delete(reason) {
      deleteCalls.push(reason);
    },
  };
  const client = fakeClient({ channelsById: { 'due-channel': channel } });

  await cleanupDueScoutReportChannels(client, now);

  assert.deepEqual(client._calls, [['fetch', 'due-channel']]);
  assert.deepEqual(deleteCalls, ['Scout report archived more than 24 hours ago']);
  const report = prepare('SELECT temp_deleted_at FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.temp_deleted_at, now);
});

test('cleanupDueScoutReportChannels marks missing temp channel deleted so it does not retry forever', async () => {
  const now = 1_700_000_000;
  const nullCallId = insertScoutReport({
    tempChannelId: 'missing-null-channel',
    reportedAt: now - 100,
    deleteAfter: now - 1,
  });
  const notFound = new Error('Unknown Channel');
  notFound.code = 10003;
  const throwCallId = insertScoutReport({
    tempChannelId: 'missing-throw-channel',
    reportedAt: now - 100,
    deleteAfter: now - 1,
  });
  const client = fakeClient({
    fetchErrorById: { 'missing-throw-channel': notFound },
  });

  await cleanupDueScoutReportChannels(client, now);

  assert.equal(
    prepare('SELECT temp_deleted_at FROM scout_reports WHERE call_id = ?').get(nullCallId).temp_deleted_at,
    now,
  );
  assert.equal(
    prepare('SELECT temp_deleted_at FROM scout_reports WHERE call_id = ?').get(throwCallId).temp_deleted_at,
    now,
  );
});

test('cleanupDueScoutReportChannels does not mark deleted when channel deletion fails', async () => {
  const now = 1_700_000_000;
  const callId = insertScoutReport({
    tempChannelId: 'delete-fails-channel',
    reportedAt: now - 100,
    deleteAfter: now - 1,
  });
  const channel = {
    async delete() {
      throw new Error('Missing permissions');
    },
  };
  const client = fakeClient({ channelsById: { 'delete-fails-channel': channel } });

  await cleanupDueScoutReportChannels(client, now);

  const report = prepare('SELECT temp_deleted_at FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.temp_deleted_at, null);
});

test('cleanupDueScoutReportChannels marks deleted when channel disappears during delete', async () => {
  const now = 1_700_000_000;
  const callId = insertScoutReport({
    tempChannelId: 'delete-not-found-channel',
    reportedAt: now - 100,
    deleteAfter: now - 1,
  });
  const notFound = new Error('Unknown Channel');
  notFound.code = 10003;
  const channel = {
    async delete() {
      throw notFound;
    },
  };
  const client = fakeClient({ channelsById: { 'delete-not-found-channel': channel } });

  await cleanupDueScoutReportChannels(client, now);

  const report = prepare('SELECT temp_deleted_at FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.temp_deleted_at, now);
});
