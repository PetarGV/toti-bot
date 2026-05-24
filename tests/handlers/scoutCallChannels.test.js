import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare, setConfig } from '../../src/db/client.js';
import { routeModal } from '../../src/handlers/router.js';
import {
  buildScoutEmbed,
  handleScoutCommand,
  handleScoutJoinButton,
  handleScoutJoinModal,
  handleScoutReportModal,
} from '../../src/handlers/scoutCall.js';
import {
  clearPendingScoutReportUploads,
  handleScoutReportMessage,
} from '../../src/handlers/scoutReportUpload.js';

function scoutCommitment(amount) {
  return JSON.stringify({ kind: 'scout_commitment', amount });
}

function fakeGuild(options = {}) {
  const channels = [];
  const {
    tempChannelSendError = null,
  } = options;
  return {
    id: 'guild-1',
    channels: {
      cache: { values: () => channels.values() },
      async create(payload) {
        const channel = {
          id: `chan-${channels.length + 1}`,
          name: payload.name,
          type: payload.type,
          parentId: payload.parent ?? null,
          topic: payload.topic ?? null,
          deleted: false,
          async send(messagePayload) {
            if (payload.type === ChannelType.GuildText && payload.parent && tempChannelSendError) {
              throw tempChannelSendError;
            }
            channel._sent = messagePayload;
            return { id: 'scout-message-1' };
          },
          async delete() {
            channel.deleted = true;
          },
        };
        channels.push(channel);
        return channel;
      },
    },
    _channels: channels,
  };
}

function fakeScoutInteraction(guild) {
  const calls = [];
  return {
    guild,
    guildId: guild.id,
    channel: {
      id: 'source-channel',
      async send() {
        throw new Error('source channel send should not be used directly');
      },
    },
    user: { id: 'requester-1' },
    options: {
      getString(name) {
        return {
          coords: '-50|72',
          notes: 'Need final report',
          'min-scouts': '200',
        }[name] ?? null;
      },
    },
    async deferReply(payload) {
      calls.push(['deferReply', payload]);
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push(['editReply', payload]);
      this.replied = true;
    },
    _calls: calls,
  };
}

function fakeScoutInteractionWithReplyError(guild) {
  const interaction = fakeScoutInteraction(guild);
  interaction.editReply = async function editReply(payload) {
    this._calls.push(['editReply', payload]);
    this.replied = true;
    throw new Error('reply failed');
  };
  return interaction;
}

function insertScoutCall(overrides = {}) {
  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, message_id, channel_id, status, payload)
    VALUES ('scout', ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    overrides.authorId ?? 'requester-1',
    overrides.x ?? -50,
    overrides.y ?? 72,
    overrides.messageId ?? 'message-1',
    overrides.channelId ?? 'channel-1',
    overrides.status ?? 'open',
    JSON.stringify(overrides.payload ?? {}),
  );
  const callId = result.lastInsertRowid;
  prepare('INSERT INTO scout_reports (call_id, scout_code, temp_channel_id) VALUES (?, ?, ?)')
    .run(callId, overrides.scoutCode ?? 'a1b2', overrides.channelId ?? 'channel-1');
  return callId;
}

function fakeRefreshClient(calls) {
  return {
    channels: {
      async fetch(channelId) {
        calls.push(['fetchChannel', channelId]);
        if (channelId === 'archive-channel') {
          return {
            async send(payload) {
              calls.push(['archiveSend', payload]);
              return {
                id: 'archive-message-1',
                url: 'https://discord.test/channels/guild/archive-channel/archive-message-1',
                attachments: new Map([
                  ['copy-1', { url: 'https://cdn.discordapp.test/archive/report.png' }],
                ]),
              };
            },
          };
        }
        return {
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
      },
    },
  };
}

function fakeScoutJoinButtonInteraction({ callId, userId = 'scout-1' }) {
  const calls = [];
  return {
    customId: `scout:join:${callId}`,
    user: { id: userId },
    async reply(payload) {
      calls.push(['reply', payload]);
      this.replied = true;
    },
    async showModal(modal) {
      calls.push(['showModal', modal.toJSON()]);
    },
    _calls: calls,
  };
}

function fakeScoutJoinModalInteraction({ callId, userId = 'scout-1', amount = '50' }) {
  const calls = [];
  return {
    customId: `scout:join_submit:${callId}`,
    user: { id: userId },
    client: fakeRefreshClient(calls),
    fields: {
      getTextInputValue(name) {
        return name === 'amount' ? amount : '';
      },
    },
    async reply(payload) {
      calls.push(['reply', payload]);
      this.replied = true;
    },
    _calls: calls,
  };
}

function fakeScoutReportModalInteraction({
  callId,
  userId = 'scout-1',
  note = 'Report text',
  channelId = 'channel-1',
}) {
  const calls = [];
  return {
    customId: `scout:report_submit:${callId}`,
    user: { id: userId },
    channelId,
    client: fakeRefreshClient(calls),
    fields: {
      getTextInputValue(name) {
        return name === 'note' ? note : '';
      },
    },
    async reply(payload) {
      calls.push(['reply', payload]);
      this.replied = true;
    },
    _calls: calls,
  };
}

function fakeScoutReportMessage({ client, userId = 'scout-1', channelId = 'channel-1' }) {
  const calls = [];
  return {
    author: { id: userId, bot: false },
    channelId,
    client,
    attachments: new Map([
      ['att-1', {
        id: 'att-1',
        name: 'report.png',
        url: 'https://cdn.discordapp.test/report.png',
        contentType: 'image/png',
      }],
    ]),
    async reply(payload) {
      calls.push(['messageReply', payload]);
    },
    _calls: calls,
  };
}

test('scout command creates temp channel and stores scout report metadata', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO x_world (id, x, y, player, alliance) VALUES (?, ?, ?, ?, ?)')
    .run(1, -50, 72, 'Enemy Name', 'BAD');

  const guild = fakeGuild();
  const interaction = fakeScoutInteraction(guild);

  await handleScoutCommand(interaction);

  const call = prepare('SELECT * FROM calls').get();
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(call.id);
  const payload = JSON.parse(call.payload);

  assert.equal(call.channel_id, report.temp_channel_id);
  assert.equal(payload.minScouts, '200');
  assert.equal(payload.targetPlayer, 'Enemy Name');
  assert.equal(payload.targetAlliance, 'BAD');
  assert.equal(payload.tempChannelId, call.channel_id);
  assert.equal(payload.guildId, 'guild-1');
  assert.match(payload.scoutCode, /^[a-z0-9]{4}$/);
  assert.equal(report.scout_code, payload.scoutCode);
  assert.match(guild._channels.find(c => c.id === call.channel_id).name, /^scout-[a-z0-9]{4}-x-50-y72-enemy-name$/);
  assert.equal(guild._channels.find(c => c.id === call.channel_id).type, ChannelType.GuildText);
  assert.match(interaction._calls.at(-1)[1].content, /Scout request created:/);
});

test('scout command cleans up rows and temp channel when temp channel send fails', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild({ tempChannelSendError: new Error('send failed') });
  const interaction = fakeScoutInteraction(guild);

  await assert.rejects(handleScoutCommand(interaction), /send failed/);

  assert.equal(prepare('SELECT COUNT(*) AS count FROM calls').get().count, 0);
  assert.equal(prepare('SELECT COUNT(*) AS count FROM scout_reports').get().count, 0);

  const tempChannel = guild._channels.find(channel => /^scout-[a-z0-9]{4}-/.test(channel.name));
  assert.equal(tempChannel?.deleted, true);
});

test('scout command keeps published request when source reply update fails', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO x_world (id, x, y, player, alliance) VALUES (?, ?, ?, ?, ?)')
    .run(1, -50, 72, 'Enemy Name', 'BAD');

  const guild = fakeGuild();
  const interaction = fakeScoutInteractionWithReplyError(guild);

  await assert.rejects(handleScoutCommand(interaction), /reply failed/);

  const call = prepare('SELECT * FROM calls').get();
  assert.ok(call);
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(call.id);
  const tempChannel = guild._channels.find(channel => channel.id === call.channel_id);

  assert.ok(report);
  assert.equal(call.message_id, 'scout-message-1');
  assert.equal(tempChannel?.deleted, false);
});

test('buildScoutEmbed prefers stored target snapshot over current x_world row', async () => {
  await setupTestDb();
  resetTables();

  prepare('INSERT INTO x_world (id, x, y, player, alliance) VALUES (?, ?, ?, ?, ?)')
    .run(1, -50, 72, 'New Player', 'NEW');

  const call = {
    id: 42,
    type: 'scout',
    author_id: 'requester-1',
    x: -50,
    y: 72,
    status: 'open',
    payload: JSON.stringify({
      targetPlayer: 'Original Player',
      targetAlliance: 'OLD',
    }),
  };

  const embed = buildScoutEmbed(call, []);
  const coordsField = embed.data.fields.find(field => field.name === 'Coords');

  assert.match(coordsField.value, /Original Player \[OLD\]/);
  assert.doesNotMatch(coordsField.value, /New Player \[NEW\]/);
});

test('buildScoutEmbed renders minimum, committed, and remaining scout progress', async () => {
  await setupTestDb();
  resetTables();

  const call = {
    id: 42,
    type: 'scout',
    author_id: 'requester-1',
    x: -50,
    y: 72,
    status: 'open',
    payload: JSON.stringify({ minScouts: '200' }),
  };

  const embed = buildScoutEmbed(call, [
    { user_id: 'scout-1', amount: scoutCommitment('50') },
    { user_id: 'scout-2', amount: 'On it' },
    { user_id: 'scout-3', amount: scoutCommitment('75 scouts') },
  ]);

  const fields = Object.fromEntries(embed.data.fields.map(field => [field.name, field.value]));
  assert.equal(fields['Minimum scouts'], '200');
  assert.equal(fields['Committed scouts'], '125');
  assert.equal(fields['Remaining scouts'], '75');

  const commitmentField = embed.data.fields.find(field => field.name.startsWith('On it'));
  assert.match(commitmentField.value, /<@scout-1> \(50\)/);
  assert.match(commitmentField.value, /<@scout-2>/);
  assert.match(commitmentField.value, /<@scout-3> \(75 scouts\)/);
  assert.equal(embed.data.fields.some(field => field.name.startsWith('Reports')), false);
});

test('buildScoutEmbed keeps number-leading report text out of scout progress', async () => {
  await setupTestDb();
  resetTables();

  const call = {
    id: 43,
    type: 'scout',
    author_id: 'requester-1',
    x: -50,
    y: 72,
    status: 'open',
    payload: JSON.stringify({ minScouts: '200' }),
  };

  const embed = buildScoutEmbed(call, [
    { user_id: 'scout-1', amount: scoutCommitment('75 scouts') },
    { user_id: 'scout-2', amount: '200 scouts found in village' },
  ]);

  const fields = Object.fromEntries(embed.data.fields.map(field => [field.name, field.value]));
  assert.equal(fields['Committed scouts'], '75');
  assert.equal(fields['Remaining scouts'], '125');

  const commitmentField = embed.data.fields.find(field => field.name.startsWith('On it'));
  assert.match(commitmentField.value, /<@scout-1> \(75 scouts\)/);
  assert.doesNotMatch(commitmentField.value, /scout-2/);

  const reportsField = embed.data.fields.find(field => field.name.startsWith('Reports'));
  assert.match(reportsField.value, /<@scout-2>/);
  assert.match(reportsField.value, /200 scouts found in village/);
});

test('buildScoutEmbed treats raw commitment-looking text as a scout report', async () => {
  await setupTestDb();
  resetTables();

  const call = {
    id: 44,
    type: 'scout',
    author_id: 'requester-1',
    x: -50,
    y: 72,
    status: 'open',
    payload: JSON.stringify({ minScouts: '200' }),
  };

  const embed = buildScoutEmbed(call, [
    { user_id: 'scout-1', amount: 'commitment:75 scouts found' },
  ]);

  const fields = Object.fromEntries(embed.data.fields.map(field => [field.name, field.value]));
  assert.equal(fields['Committed scouts'], '0');
  assert.equal(fields['Remaining scouts'], '200');

  const commitmentField = embed.data.fields.find(field => field.name.startsWith('On it'));
  assert.doesNotMatch(commitmentField.value, /scout-1/);

  const reportsField = embed.data.fields.find(field => field.name.startsWith('Reports'));
  assert.match(reportsField.value, /<@scout-1>/);
  assert.match(reportsField.value, /commitment:75 scouts found/);
});

test('handleScoutJoinButton opens amount modal instead of toggling immediately', async () => {
  await setupTestDb();
  resetTables();
  const callId = insertScoutCall();

  const interaction = fakeScoutJoinButtonInteraction({ callId });

  await handleScoutJoinButton(interaction);

  assert.equal(prepare('SELECT COUNT(*) AS count FROM pledges').get().count, 0);
  assert.equal(interaction._calls.length, 1);
  assert.equal(interaction._calls[0][0], 'showModal');
  const modal = interaction._calls[0][1];
  assert.equal(modal.custom_id, `scout:join_submit:${callId}`);
  assert.equal(modal.title, 'Scout Commitment');
  assert.equal(modal.components[0].components[0].custom_id, 'amount');
  assert.equal(modal.components[0].components[0].required, false);
});

test('handleScoutJoinModal stores numeric commitment, refreshes call, and replies ephemerally', async () => {
  await setupTestDb();
  resetTables();
  const callId = insertScoutCall({ payload: { minScouts: '200' } });
  const interaction = fakeScoutJoinModalInteraction({ callId, amount: ' 75 scouts ' });

  await handleScoutJoinModal(interaction);

  const pledge = prepare('SELECT user_id, amount FROM pledges WHERE call_id = ?').get(callId);
  assert.deepEqual(pledge, { user_id: 'scout-1', amount: scoutCommitment('75 scouts') });
  assert.equal(interaction._calls.some(call => call[0] === 'editMessage'), true);
  const reply = interaction._calls.find(call => call[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /75 scouts/);
});

test('handleScoutJoinModal rejects non-numeric commitment input without storing or refreshing', async () => {
  await setupTestDb();
  resetTables();
  const callId = insertScoutCall({ payload: { minScouts: '200' } });
  const interaction = fakeScoutJoinModalInteraction({ callId, amount: 'many scouts' });

  await handleScoutJoinModal(interaction);

  assert.equal(prepare('SELECT COUNT(*) AS count FROM pledges WHERE call_id = ?').get(callId).count, 0);
  assert.equal(interaction._calls.some(call => call[0] === 'editMessage'), false);
  const reply = interaction._calls.find(call => call[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /number/i);
});

test('handleScoutJoinModal does not overwrite an existing scout report pledge', async () => {
  await setupTestDb();
  resetTables();
  const callId = insertScoutCall({ payload: { minScouts: '200' } });
  prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
    .run(callId, 'scout-1', 'Report says 500 scouts present');
  const interaction = fakeScoutJoinModalInteraction({ callId, amount: '75' });

  await handleScoutJoinModal(interaction);

  const pledge = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, 'scout-1');
  assert.equal(pledge.amount, 'Report says 500 scouts present');
  assert.equal(interaction._calls.some(call => call[0] === 'editMessage'), false);
  const reply = interaction._calls.find(call => call[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /already submitted a report/i);
});

test('handleScoutReportModal starts pending upload from temp channel without writing a pledge', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  setConfig('scout_reports_channel_id', 'archive-channel');
  const callId = insertScoutCall({ payload: { minScouts: '200' } });
  const interaction = fakeScoutReportModalInteraction({
    callId,
    note: ' commitment:75 scouts found ',
  });

  await handleScoutReportModal(interaction);

  assert.equal(prepare('SELECT COUNT(*) AS count FROM pledges WHERE call_id = ?').get(callId).count, 0);
  assert.equal(interaction._calls.some(callEntry => callEntry[0] === 'editMessage'), false);
  const reply = interaction._calls.find(callEntry => callEntry[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /upload exactly one screenshot/i);
  assert.match(reply.content, /10 minutes/i);

  const message = fakeScoutReportMessage({ client: interaction.client });
  assert.equal(await handleScoutReportMessage(message, 1_700_000_000), true);

  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(callId);
  assert.equal(report.reporter_id, 'scout-1');
  assert.equal(report.report_note, 'commitment:75 scouts found');
  assert.equal(report.reported_at, 1_700_000_000);
  assert.equal(report.delete_after, 1_700_086_400);
  assert.equal(interaction._calls.some(callEntry => callEntry[0] === 'archiveSend'), true);
  assert.equal(interaction._calls.some(callEntry => callEntry[0] === 'editMessage'), true);
});

test('handleScoutReportModal rejects submissions outside the scout temp channel', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall();
  const interaction = fakeScoutReportModalInteraction({
    callId,
    channelId: 'other-channel',
    note: 'Wrong place',
  });

  await handleScoutReportModal(interaction);

  assert.equal(prepare('SELECT COUNT(*) AS count FROM pledges WHERE call_id = ?').get(callId).count, 0);
  const reply = interaction._calls.find(callEntry => callEntry[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /temporary scout channel/i);
  const message = fakeScoutReportMessage({ client: interaction.client });
  assert.equal(await handleScoutReportMessage(message, 1_700_000_000), false);
});

test('handleScoutReportModal reports existing archive link when already archived', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall({ payload: { guildId: 'guild-1' } });
  prepare(`
    UPDATE scout_reports
    SET archive_channel_id = ?, archive_message_id = ?, reported_at = ?
    WHERE call_id = ?
  `).run('archive-channel', 'archive-message-1', 1_700_000_000, callId);
  const interaction = fakeScoutReportModalInteraction({ callId, note: 'Another report' });

  await handleScoutReportModal(interaction);

  const reply = interaction._calls.find(callEntry => callEntry[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /already archived/i);
  assert.match(reply.content, /https:\/\/discord\.com\/channels\/guild-1\/archive-channel\/archive-message-1/);
  assert.doesNotMatch(reply.content, /channels\/@me\//);
});

test('handleScoutReportModal reports archive link for closed archived calls', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  const callId = insertScoutCall({ status: 'closed', payload: { guildId: 'guild-1' } });
  prepare(`
    UPDATE scout_reports
    SET archive_channel_id = ?, archive_message_id = ?, reported_at = ?
    WHERE call_id = ?
  `).run('archive-channel', 'archive-message-1', 1_700_000_000, callId);
  const interaction = fakeScoutReportModalInteraction({ callId, note: 'Another report' });

  await handleScoutReportModal(interaction);

  const reply = interaction._calls.find(callEntry => callEntry[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /already archived/i);
  assert.match(reply.content, /https:\/\/discord\.com\/channels\/guild-1\/archive-channel\/archive-message-1/);
  assert.doesNotMatch(reply.content, /channels\/@me\//);
});

test('router dispatches scout join submission modals to handleScoutJoinModal', async () => {
  await setupTestDb();
  resetTables();
  const callId = insertScoutCall();
  const interaction = fakeScoutJoinModalInteraction({ callId, userId: 'scout-2', amount: '50' });

  await routeModal(interaction);

  const pledge = prepare('SELECT user_id, amount FROM pledges WHERE call_id = ?').get(callId);
  assert.deepEqual(pledge, { user_id: 'scout-2', amount: scoutCommitment('50') });
});
