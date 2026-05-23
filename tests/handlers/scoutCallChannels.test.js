import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import { handleScoutCommand } from '../../src/handlers/scoutCall.js';

function fakeGuild() {
  const channels = [];
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
          async send(messagePayload) {
            channel._sent = messagePayload;
            return { id: 'scout-message-1' };
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
