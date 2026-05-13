import { getConfig } from '../db/client.js';

export function getPrimaryGuild(client) {
  const id = getConfig('primary_guild_id');
  if (id) return client.guilds.cache.get(id) ?? null;
  return client.guilds.cache.first() ?? null;
}

export function getNotificationsChannel(guild) {
  if (!guild) return null;
  const id = getConfig('notifications_channel_id');
  if (id) return guild.channels.cache.get(id) ?? null;
  return guild.channels.cache.find(c => c.name === 'bot-notifications' && c.isTextBased?.()) ?? null;
}
