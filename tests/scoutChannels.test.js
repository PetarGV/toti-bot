import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { getConfig } from '../src/db/client.js';
import { handleSetup } from '../src/commands/admin.js';
import {
  findChannelByNameAndType,
  findChildChannelByName,
  ensureScoutInfrastructure,
} from '../src/utils/scoutChannels.js';

function fakeChannel(id, name, type, parentId = null) {
  return { id, name, type, parentId };
}

function fakeGuild(existing = []) {
  const channels = [...existing];
  const cache = {
    values() {
      return channels.values();
    },
  };

  return {
    channels: {
      cache,
      async create(payload) {
        const channel = fakeChannel(`created-${channels.length + 1}`, payload.name, payload.type, payload.parent ?? null);
        channels.push(channel);
        return channel;
      },
    },
    _channels: channels,
  };
}

test('findChannelByNameAndType matches case-insensitive channel name and type', () => {
  const guild = fakeGuild([
    fakeChannel('1', 'Scouting', ChannelType.GuildCategory),
    fakeChannel('2', 'scout-reports', ChannelType.GuildText),
  ]);

  assert.equal(findChannelByNameAndType(guild, 'scouting', ChannelType.GuildCategory).id, '1');
  assert.equal(findChannelByNameAndType(guild, 'SCOUT-REPORTS', ChannelType.GuildText).id, '2');
  assert.equal(findChannelByNameAndType(guild, 'missing', ChannelType.GuildText), null);
});

test('findChildChannelByName requires matching parent id', () => {
  const guild = fakeGuild([
    fakeChannel('1', 'scout-reports', ChannelType.GuildText, 'cat-a'),
    fakeChannel('2', 'scout-reports', ChannelType.GuildText, 'cat-b'),
  ]);

  assert.equal(findChildChannelByName(guild, 'scout-reports', 'cat-b').id, '2');
  assert.equal(findChildChannelByName(guild, 'scout-reports', 'cat-c'), null);
});

test('ensureScoutInfrastructure creates missing Scouting category and archive channel', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild();

  const result = await ensureScoutInfrastructure(guild);

  assert.equal(result.category.name, 'Scouting');
  assert.equal(result.archiveChannel.name, 'scout-reports');
  assert.equal(result.archiveChannel.parentId, result.category.id);
  assert.equal(guild._channels.length, 2);
});

test('ensureScoutInfrastructure reuses existing category and archive channel', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild([
    fakeChannel('cat-1', 'Scouting', ChannelType.GuildCategory),
    fakeChannel('archive-1', 'scout-reports', ChannelType.GuildText, 'cat-1'),
  ]);

  const result = await ensureScoutInfrastructure(guild);

  assert.equal(result.category.id, 'cat-1');
  assert.equal(result.archiveChannel.id, 'archive-1');
  assert.equal(guild._channels.length, 2);
});

test('ensureScoutInfrastructure ignores same-named archive channel outside scouting category', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild([
    fakeChannel('cat-1', 'Scouting', ChannelType.GuildCategory),
    fakeChannel('archive-old', 'scout-reports', ChannelType.GuildText, 'other-cat'),
  ]);

  const result = await ensureScoutInfrastructure(guild);

  assert.equal(result.category.id, 'cat-1');
  assert.equal(result.archiveChannel.parentId, 'cat-1');
  assert.notEqual(result.archiveChannel.id, 'archive-old');
  assert.equal(guild._channels.length, 3);
});

test('handleSetup scout creates infrastructure before deploying panel', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild();
  const calls = [];
  const interaction = {
    guild,
    channel: {
      id: 'panel-channel',
      name: 'scout-panel',
      messages: { async fetch() { throw new Error('no old panel'); } },
      async send(payload) {
        calls.push(['send', payload]);
        return { id: 'panel-msg', async pin() {} };
      },
    },
    options: { getSubcommand: () => 'scout' },
    async deferReply(payload) { calls.push(['deferReply', payload]); },
    async editReply(payload) { calls.push(['editReply', payload]); },
  };

  await handleSetup(interaction);

  assert.equal(getConfig('scouting_category_id'), 'created-1');
  assert.equal(getConfig('scout_reports_channel_id'), 'created-2');
  assert.equal(calls.at(-1)[1].content, '✅ scout panel deployed and pinned.');
});
