import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare, setConfig } from '../../src/db/client.js';
import {
  clearPendingScoutReportUploads,
  handleScoutReportMessage,
  startPendingScoutReportUpload,
} from '../../src/handlers/scoutReportUpload.js';
import { handleScoutJoinModal } from '../../src/handlers/scoutCall.js';
import { REPORT_UPLOAD_WINDOW_SEC } from '../../src/utils/scoutReports.js';

function insertScoutCall(overrides = {}) {
  const payload = JSON.stringify(overrides.payload ?? {
    scoutCode: 'a1b2',
    targetPlayer: 'Target Player',
    targetAlliance: 'BAD',
  });
  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, message_id, channel_id, status, payload)
    VALUES ('scout', ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    overrides.authorId ?? 'requester-1',
    overrides.x ?? -50,
    overrides.y ?? 72,
    overrides.messageId ?? 'message-1',
    overrides.channelId ?? 'temp-channel',
    overrides.status ?? 'open',
    payload,
  );
  const callId = result.lastInsertRowid;
  prepare('INSERT INTO scout_reports (call_id, scout_code, temp_channel_id) VALUES (?, ?, ?)')
    .run(callId, overrides.scoutCode ?? 'a1b2', overrides.channelId ?? 'temp-channel');
  return callId;
}

function attachment(overrides = {}) {
  return {
    id: overrides.id ?? 'att-1',
    name: overrides.name ?? 'report.png',
    url: overrides.url ?? 'https://cdn.discordapp.test/report.png',
    contentType: overrides.contentType ?? 'image/png',
  };
}

function fakeClient(calls, options = {}) {
  const archiveChannel = {
    async send(payload) {
      calls.push(['archiveSend', payload]);
      if (options.archiveSend) {
        return options.archiveSend(payload);
      }
      return {
        id: 'archive-message-1',
        url: 'https://discord.test/channels/guild/archive-channel/archive-message-1',
        attachments: new Map([
          ['copy-1', { url: 'https://cdn.discordapp.test/archive/report.png' }],
        ]),
      };
    },
  };
  const tempChannel = {
    messages: {
      async fetch(messageId) {
        calls.push(['fetchMessage', messageId]);
        return {
          async edit(payload) {
            calls.push(['editMessage', payload]);
          },
        };
      },
    },
  };
  return {
    channels: {
      async fetch(channelId) {
        calls.push(['fetchChannel', channelId]);
        if (channelId === 'archive-channel') return archiveChannel;
        if (channelId === 'temp-channel') return tempChannel;
        return null;
      },
    },
  };
}

function fakeMessage({
  userId = 'scout-1',
  bot = false,
  channelId = 'temp-channel',
  attachments = [],
  client,
} = {}) {
  const calls = [];
  const message = {
    author: { id: userId, bot },
    channelId,
    attachments: new Map(attachments.map((att, idx) => [att.id ?? `att-${idx}`, att])),
    client: client ?? fakeClient(calls),
    async reply(payload) {
      calls.push(['reply', payload]);
    },
    _calls: calls,
  };
  return message;
}

function fakeScoutJoinModalInteraction({ callId, userId = 'scout-2', amount = '50' }) {
  const calls = [];
  return {
    customId: `scout:join_submit:${callId}`,
    user: { id: userId },
    client: fakeClient(calls),
    fields: {
      getTextInputValue(name) {
        return name === 'amount' ? amount : '';
      },
    },
    async reply(payload) {
      calls.push(['reply', payload]);
    },
    _calls: calls,
  };
}

test('bot messages are ignored even with an active pending upload', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'bot-1',
    channelId: 'temp-channel',
    note: null,
    now: 1_700_000_000,
  });

  const message = fakeMessage({
    userId: 'bot-1',
    bot: true,
    attachments: [attachment()],
  });
  const handled = await handleScoutReportMessage(message, 1_700_000_010);

  assert.equal(handled, false);
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.reported_at, null);
  assert.equal(message._calls.length, 0);
});

test('upload without pending state is ignored and leaves scout report unchanged', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall();

  const message = fakeMessage({ attachments: [attachment()] });
  const handled = await handleScoutReportMessage(message, 1_700_000_000);

  assert.equal(handled, false);
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.reported_at, null);
  assert.equal(message._calls.length, 0);
});

test('upload from wrong user during pending submit is ignored', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: null,
    now: 1_700_000_000,
  });

  const message = fakeMessage({ userId: 'scout-2', attachments: [attachment()] });
  const handled = await handleScoutReportMessage(message, 1_700_000_010);

  assert.equal(handled, false);
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.reported_at, null);
  assert.equal(message._calls.length, 0);
});

test('expired pending upload is ignored and clears pending state', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: null,
    now: 100,
  });

  const expired = fakeMessage({ attachments: [attachment()] });
  const expiredAt = 100 + REPORT_UPLOAD_WINDOW_SEC + 1;
  assert.equal(await handleScoutReportMessage(expired, expiredAt), false);
  assert.equal(prepare('SELECT reported_at FROM scout_reports WHERE call_id = ?').get(callId).reported_at, null);
  assert.equal(expired._calls.length, 0);

  const laterValid = fakeMessage({ attachments: [attachment()] });
  assert.equal(await handleScoutReportMessage(laterValid, expiredAt + 1), false);
  assert.equal(prepare('SELECT reported_at FROM scout_reports WHERE call_id = ?').get(callId).reported_at, null);
  assert.equal(laterValid._calls.length, 0);
});

test('upload from wrong channel during pending submit is ignored', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: null,
    now: 1_700_000_000,
  });

  const message = fakeMessage({ channelId: 'other-channel', attachments: [attachment()] });
  assert.equal(await handleScoutReportMessage(message, 1_700_000_010), false);
  assert.equal(prepare('SELECT reported_at FROM scout_reports WHERE call_id = ?').get(callId).reported_at, null);
  assert.equal(message._calls.length, 0);
});

test('pending upload archives one valid image and marks report submitted with 24h delete_after', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: 'Wall is empty',
    now: 1_700_000_000,
  });

  const message = fakeMessage({ attachments: [attachment({ name: 'wall.png' })] });
  const handled = await handleScoutReportMessage(message, 1_700_000_100);

  assert.equal(handled, true);
  const archiveSend = message._calls.find(call => call[0] === 'archiveSend')[1];
  assert.equal(archiveSend.files.length, 1);
  assert.equal(archiveSend.files[0].attachment, 'https://cdn.discordapp.test/report.png');
  assert.equal(archiveSend.files[0].name, 'wall.png');
  assert.equal(archiveSend.embeds[0].data.image.url, 'attachment://wall.png');
  const fields = Object.fromEntries(archiveSend.embeds[0].data.fields.map(field => [field.name, field.value]));
  assert.equal(fields.Code, '`a1b2`');
  assert.match(fields.Coords, /\[\(-50\|72\)\]\(https:\/\/ts2\.x1\.international\.travian\.com\/karte\.php\?x=-50&y=72\)/);
  assert.equal(fields.Target, 'Target Player [BAD]');
  assert.equal(fields.Requester, '<@requester-1>');
  assert.equal(fields.Reporter, '<@scout-1>');
  assert.equal(fields['Call ID'], String(callId));
  assert.equal(fields['Scout channel'], '<#temp-channel>');
  assert.equal(fields.Note, 'Wall is empty');

  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.archive_channel_id, 'archive-channel');
  assert.equal(report.archive_message_id, 'archive-message-1');
  assert.equal(report.reporter_id, 'scout-1');
  assert.equal(report.report_note, 'Wall is empty');
  assert.equal(report.screenshot_url, 'https://cdn.discordapp.test/archive/report.png');
  assert.equal(report.reported_at, 1_700_000_100);
  assert.equal(report.delete_after, 1_700_086_500);
  assert.equal(message._calls.some(call => call[0] === 'editMessage'), true);
  const reply = message._calls.find(call => call[0] === 'reply')[1];
  assert.match(reply.content, /archived/i);
  assert.match(reply.content, /24h/i);
});

test('overlapping valid uploads from the pending user only archive one screenshot', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: 'Wall is empty',
    now: 1_700_000_000,
  });

  let releaseArchive;
  const archiveSendCalls = [];
  const archiveSend = async payload => {
    archiveSendCalls.push(payload);
    if (archiveSendCalls.length === 1) {
      await new Promise(resolve => { releaseArchive = resolve; });
    }
    return {
      id: `archive-message-${archiveSendCalls.length}`,
      url: `https://discord.test/channels/guild/archive-channel/archive-message-${archiveSendCalls.length}`,
      attachments: new Map([
        ['copy-1', { url: `https://cdn.discordapp.test/archive/report-${archiveSendCalls.length}.png` }],
      ]),
    };
  };
  const calls = [];
  const client = fakeClient(calls, { archiveSend });
  const messageA = fakeMessage({ client, attachments: [attachment({ id: 'att-a', name: 'wall-a.png' })] });
  const messageB = fakeMessage({ client, attachments: [attachment({ id: 'att-b', name: 'wall-b.png' })] });

  const first = handleScoutReportMessage(messageA, 1_700_000_100);
  await Promise.resolve();
  assert.equal(archiveSendCalls.length, 1);

  const secondHandled = await handleScoutReportMessage(messageB, 1_700_000_100);
  releaseArchive();
  const firstHandled = await first;

  assert.equal(firstHandled, true);
  assert.equal(secondHandled, false);
  assert.equal(archiveSendCalls.length, 1);
  const report = prepare('SELECT archive_message_id, reported_at FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.archive_message_id, 'archive-message-1');
  assert.equal(report.reported_at, 1_700_000_100);
});

test('overlapping valid uploads from different pending users only archive one screenshot', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: 'Wall is empty',
    now: 1_700_000_000,
  });
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-2',
    channelId: 'temp-channel',
    note: 'Wall is also empty',
    now: 1_700_000_000,
  });

  let releaseArchive;
  const archiveSendCalls = [];
  const archiveSend = async payload => {
    archiveSendCalls.push(payload);
    if (archiveSendCalls.length === 1) {
      await new Promise(resolve => { releaseArchive = resolve; });
    }
    return {
      id: `archive-message-${archiveSendCalls.length}`,
      url: `https://discord.test/channels/guild/archive-channel/archive-message-${archiveSendCalls.length}`,
      attachments: new Map([
        ['copy-1', { url: `https://cdn.discordapp.test/archive/report-${archiveSendCalls.length}.png` }],
      ]),
    };
  };
  const calls = [];
  const client = fakeClient(calls, { archiveSend });
  const messageA = fakeMessage({ userId: 'scout-1', client, attachments: [attachment({ id: 'att-a', name: 'wall-a.png' })] });
  const messageB = fakeMessage({ userId: 'scout-2', client, attachments: [attachment({ id: 'att-b', name: 'wall-b.png' })] });

  const first = handleScoutReportMessage(messageA, 1_700_000_100);
  await Promise.resolve();
  assert.equal(archiveSendCalls.length, 1);

  const secondHandled = await handleScoutReportMessage(messageB, 1_700_000_100);
  releaseArchive();
  const firstHandled = await first;

  assert.equal(firstHandled, true);
  assert.equal([false, true].includes(secondHandled), true);
  assert.equal(archiveSendCalls.length, 1);
  const report = prepare('SELECT archive_message_id, reported_at FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.archive_message_id, 'archive-message-1');
  assert.equal(report.reported_at, 1_700_000_100);
});

test('successful archive closes the scout call and blocks later join pledges', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: 'Wall is empty',
    now: 1_700_000_000,
  });

  const message = fakeMessage({ attachments: [attachment({ name: 'wall.png' })] });
  assert.equal(await handleScoutReportMessage(message, 1_700_000_100), true);

  const call = prepare('SELECT status FROM calls WHERE id = ?').get(callId);
  assert.equal(call.status, 'closed');

  const interaction = fakeScoutJoinModalInteraction({ callId, userId: 'scout-2', amount: '75' });
  await handleScoutJoinModal(interaction);

  assert.equal(prepare('SELECT COUNT(*) AS count FROM pledges WHERE call_id = ?').get(callId).count, 0);
  assert.equal(interaction._calls.some(callEntry => callEntry[0] === 'editMessage'), false);
  const reply = interaction._calls.find(callEntry => callEntry[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /no longer open/i);
});

test('call closed while archive send is in flight does not mark report archived and deletes orphan archive message', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: 'Wall is empty',
    now: 1_700_000_000,
  });

  let releaseArchive;
  let archiveDeleted = false;
  let resolveSendStarted;
  const sendStarted = new Promise(resolve => { resolveSendStarted = resolve; });
  const archiveSend = async () => {
    resolveSendStarted();
    await new Promise(release => { releaseArchive = release; });
    return {
      id: 'archive-message-orphan',
      url: 'https://discord.test/channels/guild/archive-channel/archive-message-orphan',
      attachments: new Map([
        ['copy-1', { url: 'https://cdn.discordapp.test/archive/orphan.png' }],
      ]),
      async delete() {
        archiveDeleted = true;
      },
    };
  };
  const calls = [];
  const client = fakeClient(calls, { archiveSend });
  const message = fakeMessage({ client, attachments: [attachment({ name: 'wall.png' })] });
  const handler = handleScoutReportMessage(message, 1_700_000_100);

  await sendStarted;
  prepare("UPDATE calls SET status = 'closed' WHERE id = ?").run(callId);
  releaseArchive();
  const handled = await handler;

  assert.equal(handled, true);
  const report = prepare('SELECT archive_channel_id, archive_message_id, reported_at FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.archive_channel_id, null);
  assert.equal(report.archive_message_id, null);
  assert.equal(report.reported_at, null);
  assert.equal(prepare('SELECT status FROM calls WHERE id = ?').get(callId).status, 'closed');
  assert.equal(calls.some(call => call[0] === 'editMessage'), false);
  assert.equal(archiveDeleted, true);
  const reply = message._calls.find(call => call[0] === 'reply')[1];
  assert.match(reply.content, /no longer open|closed/i);
});

test('pending upload after call closes is rejected and clears pending state', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: 'Wall is empty',
    now: 1_700_000_000,
  });
  prepare("UPDATE calls SET status = 'closed' WHERE id = ?").run(callId);

  const message = fakeMessage({ attachments: [attachment({ name: 'wall.png' })] });
  assert.equal(await handleScoutReportMessage(message, 1_700_000_100), true);

  assert.equal(message._calls.some(call => call[0] === 'archiveSend'), false);
  assert.equal(prepare('SELECT reported_at FROM scout_reports WHERE call_id = ?').get(callId).reported_at, null);
  const reply = message._calls.find(call => call[0] === 'reply')[1];
  assert.match(reply.content, /no longer open|closed/i);

  const laterValid = fakeMessage({ attachments: [attachment({ name: 'wall.png' })] });
  assert.equal(await handleScoutReportMessage(laterValid, 1_700_000_101), false);
  assert.equal(laterValid._calls.length, 0);
});

test('invalid pending upload replies and keeps pending active for a later valid upload', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall();
  startPendingScoutReportUpload({
    callId,
    userId: 'scout-1',
    channelId: 'temp-channel',
    note: null,
    now: 1_700_000_000,
  });

  const invalid = fakeMessage({ attachments: [] });
  assert.equal(await handleScoutReportMessage(invalid, 1_700_000_010), true);
  assert.match(invalid._calls.find(call => call[0] === 'reply')[1].content, /exactly one/i);
  assert.equal(prepare('SELECT reported_at FROM scout_reports WHERE call_id = ?').get(callId).reported_at, null);

  const laterValid = fakeMessage({ attachments: [attachment()] });
  assert.equal(await handleScoutReportMessage(laterValid, 1_700_000_020), true);
  assert.equal(prepare('SELECT reported_at FROM scout_reports WHERE call_id = ?').get(callId).reported_at, 1_700_000_020);
});
