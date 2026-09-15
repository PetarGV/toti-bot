import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import { routeButton, routeModal } from '../../src/handlers/router.js';
import {
  handleReportSightingButton,
  handleReportSightingModal,
} from '../../src/handlers/scoutSighting.js';

function fakeGuild(existing = []) {
  const channels = [...existing];
  return {
    id: 'guild-1',
    channels: {
      cache: {
        values: () => channels.values(),
        get: id => channels.find(channel => channel.id === id) ?? null,
      },
      async create(payload) {
        const channel = {
          id: `created-${channels.length + 1}`,
          name: payload.name,
          type: payload.type,
          parentId: payload.parent ?? null,
          _sent: [],
          async send(messagePayload) {
            channel._sent.push(messagePayload);
            return { id: `archive-msg-${channel._sent.length}` };
          },
        };
        channels.push(channel);
        return channel;
      },
    },
    _channels: channels,
  };
}

function fakeButtonInteraction(guild) {
  const calls = [];
  return {
    customId: 'intel:report',
    guild,
    guildId: guild.id,
    user: { id: 'reporter-1' },
    async showModal(modal) {
      calls.push(['showModal', modal.toJSON()]);
    },
    _calls: calls,
  };
}

function fakeModalInteraction(guild, { coords = '-50|72', notes = 'Saw 500 axemen', userId = 'reporter-1' } = {}) {
  const calls = [];
  return {
    customId: 'intel:report:submit',
    guild,
    guildId: guild.id,
    user: { id: userId },
    fields: {
      getTextInputValue(name) {
        return { coords, notes }[name] ?? '';
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
    async reply(payload) {
      calls.push(['reply', payload]);
      this.replied = true;
    },
    _calls: calls,
  };
}

test('handleReportSightingButton opens the sighting modal', async () => {
  const guild = fakeGuild();
  const interaction = fakeButtonInteraction(guild);

  await handleReportSightingButton(interaction);

  assert.equal(interaction._calls.length, 1);
  const [, modal] = interaction._calls[0];
  assert.equal(modal.custom_id, 'intel:report:submit');
  assert.equal(modal.title, 'Report Sighting');
  assert.equal(modal.components[0].components[0].custom_id, 'coords');
  assert.equal(modal.components[1].components[0].custom_id, 'notes');
});

test('handleReportSightingModal posts a sighting embed to the scout reports channel', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO x_world (id, x, y, player, alliance) VALUES (?, ?, ?, ?, ?)')
    .run(1, -50, 72, 'Enemy Name', 'BAD');

  const guild = fakeGuild();
  const interaction = fakeModalInteraction(guild, { coords: '-50|72', notes: 'Saw 500 axemen' });

  await handleReportSightingModal(interaction);

  const category = guild._channels.find(c => c.type === ChannelType.GuildCategory);
  const archiveChannel = guild._channels.find(c => c.type === ChannelType.GuildText);
  assert.ok(category);
  assert.ok(archiveChannel);
  assert.equal(archiveChannel._sent.length, 1);

  const embed = archiveChannel._sent[0].embeds[0].data;
  assert.equal(embed.title, '📍 Sighting Report');
  const fields = Object.fromEntries(embed.fields.map(field => [field.name, field.value]));
  assert.equal(fields.Reporter, '<@reporter-1>');
  assert.match(fields.Coords, /\(-50\|72\)/);
  assert.equal(fields.Target, 'Enemy Name [BAD]');
  assert.equal(fields.Notes, 'Saw 500 axemen');

  const editReply = interaction._calls.find(call => call[0] === 'editReply')[1];
  assert.match(editReply.content, /Sighting posted/);
  assert.match(editReply.content, new RegExp(`<#${archiveChannel.id}>`));
});

test('handleReportSightingModal rejects invalid coordinates without posting', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild();
  const interaction = fakeModalInteraction(guild, { coords: 'not-coords', notes: 'Something' });

  await handleReportSightingModal(interaction);

  assert.equal(guild._channels.length, 0);
  const reply = interaction._calls.find(call => call[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /Invalid coordinates/);
});

test('handleReportSightingModal rejects empty notes without posting', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild();
  const interaction = fakeModalInteraction(guild, { coords: '-50|72', notes: '   ' });

  await handleReportSightingModal(interaction);

  assert.equal(guild._channels.length, 0);
  const reply = interaction._calls.find(call => call[0] === 'reply')[1];
  assert.equal(reply.ephemeral, true);
  assert.match(reply.content, /cannot be empty/);
});

test('router dispatches intel:report button and intel:report:submit modal', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild();
  const buttonInteraction = fakeButtonInteraction(guild);
  await routeButton(buttonInteraction);
  assert.equal(buttonInteraction._calls[0][0], 'showModal');

  const modalInteraction = fakeModalInteraction(guild, { coords: '10|10', notes: 'Quiet village' });
  await routeModal(modalInteraction);
  const archiveChannel = guild._channels.find(c => c.type === ChannelType.GuildText);
  assert.equal(archiveChannel._sent.length, 1);
});
