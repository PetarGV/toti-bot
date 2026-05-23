import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { setupTestDb, resetTables } from './helpers/testDb.js';
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
