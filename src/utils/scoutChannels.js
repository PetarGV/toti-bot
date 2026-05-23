import { ChannelType } from 'discord.js';
import { setConfig } from '../db/client.js';
import {
  SCOUT_CATEGORY_NAME,
  SCOUT_REPORTS_CHANNEL_NAME,
  buildScoutChannelName,
} from './scoutReports.js';

function sameName(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

export function findChannelByNameAndType(guild, name, type) {
  return Array.from(guild?.channels?.cache?.values?.() ?? [])
    .find(channel => sameName(channel.name, name) && channel.type === type) ?? null;
}

export function findChildChannelByName(guild, name, parentId) {
  return Array.from(guild?.channels?.cache?.values?.() ?? [])
    .find(channel =>
      sameName(channel.name, name)
      && channel.type === ChannelType.GuildText
      && channel.parentId === parentId
    ) ?? null;
}

export async function ensureScoutInfrastructure(guild) {
  if (!guild) throw new Error('Scout setup requires a Discord guild.');

  let category = findChannelByNameAndType(guild, SCOUT_CATEGORY_NAME, ChannelType.GuildCategory);
  if (!category) {
    category = await guild.channels.create({
      name: SCOUT_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
    });
  }

  let archiveChannel = findChildChannelByName(guild, SCOUT_REPORTS_CHANNEL_NAME, category.id)
    ?? findChannelByNameAndType(guild, SCOUT_REPORTS_CHANNEL_NAME, ChannelType.GuildText);

  if (!archiveChannel) {
    archiveChannel = await guild.channels.create({
      name: SCOUT_REPORTS_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      reason: 'Travian scout report archive',
    });
  }

  setConfig('scouting_category_id', category.id);
  setConfig('scout_reports_channel_id', archiveChannel.id);

  return { category, archiveChannel };
}

export async function createScoutTempChannel(guild, { category, code, x, y, player, topic }) {
  const name = buildScoutChannelName({ code, x, y, player });
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    topic,
    reason: `Travian scout request ${code}`,
  });
}
