import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { formatCoords } from '../utils/coords.js';
import { getTribe } from '../utils/tribes.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import {
  getPrimaryLinkForUser,
  getAllLinksForUser,
  getDualsForUser,
} from './userIgnLinks.js';

export function getProfile(userId) {
  const baseUser = prepare('SELECT discord_id, role, notify_pledges FROM users WHERE discord_id = ?').get(userId);
  const primary = getPrimaryLinkForUser(userId);
  return {
    discord_id:     baseUser?.discord_id     ?? userId,
    role:           baseUser?.role           ?? 'member',
    notify_pledges: baseUser?.notify_pledges ?? 0,
    ign:            primary?.ign        ?? null,
    home_x:         primary?.home_x     ?? null,
    home_y:         primary?.home_y     ?? null,
    tribe:          primary?.tribe      ?? null,
    link_count:     getAllLinksForUser(userId).length,
  };
}

export function getHomeCoordsString(userId) {
  const p = getProfile(userId);
  if (p.home_x != null && p.home_y != null) return formatCoords(p.home_x, p.home_y);
  return '';
}

export function setNotifyPledges(userId, value) {
  prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(userId);
  prepare('UPDATE users SET notify_pledges = ? WHERE discord_id = ?').run(value, userId);
}

export function buildProfilePayload(userId) {
  const profile = getProfile(userId);
  const tribeMeta = profile.tribe ? getTribe(profile.tribe) : null;
  const notifyOn = profile.notify_pledges === 1;
  const extraAccounts = profile.link_count > 1 ? ` (+${profile.link_count - 1} more)` : '';
  const duals = getDualsForUser(userId);

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand.primary)
    .setTitle('👤 My Profile');

  if (profile.ign) {
    embed.setDescription('Read-only view. Ask an admin if anything needs to change.')
      .addFields(
        { name: 'IGN',         value: profile.ign + extraAccounts, inline: true },
        { name: 'Home Coords', value: profile.home_x != null ? formatCoords(profile.home_x, profile.home_y) : '*not set*', inline: true },
        { name: 'Tribe',       value: tribeMeta ? `${tribeMeta.emoji} ${tribeMeta.name}` : '*not set*', inline: true },
        { name: 'DM Alerts',   value: notifyOn ? '🔔 ON' : '🔕 OFF', inline: true },
      );
    if (duals.length) {
      embed.addFields({ name: 'Shared with', value: duals.map(d => `<@${d.discord_id}>`).join(', '), inline: false });
    }
  } else {
    embed.setDescription('You haven\'t set up your profile yet. Click **🚀 Start setup** to walk through it now (IGN → crew role → home coords).');
  }
  embed.setFooter({ text: FOOTER });

  const components = [];
  if (!profile.ign) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`onboard:start:${userId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('🚀 Start setup'),
    ));
  } else {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('notify:toggle')
        .setStyle(ButtonStyle.Secondary)
        .setLabel(notifyOn ? 'DMs ON' : 'DMs OFF')
        .setEmoji(notifyOn ? '🔔' : '🔕'),
    ));
  }

  return { embeds: [embed], components, ephemeral: true };
}

export async function handleProfileCommand(interaction) {
  await interaction.reply(buildProfilePayload(interaction.user.id));
}

export async function handleProfileButton(interaction) {
  await interaction.reply(buildProfilePayload(interaction.user.id));
}

export async function handleNotifyToggle(interaction) {
  const profile = getProfile(interaction.user.id);
  const next = profile.notify_pledges === 1 ? 0 : 1;
  setNotifyPledges(interaction.user.id, next);
  const state = next === 1 ? '🔔 DM notifications **enabled**.' : '🔕 DM notifications **disabled**.';
  await interaction.reply({ content: state, ephemeral: true });
}

// Back-compat shims — these custom_ids are no longer rendered, but router may still import them.
export async function handleProfileModal(interaction) {
  return interaction.reply({ content: 'This flow has been removed. Run `/profile` again — admins now handle changes.', ephemeral: true });
}
export async function handleEditIgnButton(interaction)    { return handleProfileModal(interaction); }
export async function handleEditIgnModal(interaction)     { return handleProfileModal(interaction); }
export async function handleEditCoordsButton(interaction) { return handleProfileModal(interaction); }
export async function handleEditCoordsModal(interaction)  { return handleProfileModal(interaction); }
export async function handleTribeSelect(interaction)      { return handleProfileModal(interaction); }
