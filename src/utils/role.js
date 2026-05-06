import { logger } from './logger.js';

// Per-guild cache: guildId → roleId | null
const cache = new Map();

/**
 * Returns a role mention string `<@&roleId>` for the configured def-crew role,
 * or null if the role is not found. Result is cached per guild.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<string|null>}
 */
export async function getDefRoleMention(guild) {
  if (cache.has(guild.id)) {
    const roleId = cache.get(guild.id);
    return roleId ? `<@&${roleId}>` : null;
  }

  const roleName = process.env.DEF_ROLE_NAME;
  if (!roleName) {
    cache.set(guild.id, null);
    return null;
  }

  // Try guild.roles.cache first
  let role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());

  // Fallback: fetch all roles
  if (!role) {
    try {
      const fetched = await guild.roles.fetch();
      role = fetched.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    } catch (err) {
      logger.warn(`Could not fetch roles for guild ${guild.id}:`, err.message);
    }
  }

  if (role) {
    cache.set(guild.id, role.id);
    return `<@&${role.id}>`;
  }

  // Not found — warn once and cache null
  logger.warn(`Role "${roleName}" not found in guild ${guild.id} (${guild.name}). Set DEF_ROLE_NAME correctly.`);
  cache.set(guild.id, null);
  return null;
}