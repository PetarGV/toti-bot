import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { getTribe } from '../utils/tribes.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { logger } from '../utils/logger.js';

const TRIBE_OPTIONS = [
  { value: '1', label: 'Romans',    emoji: '🛡️' },
  { value: '2', label: 'Teutons',   emoji: '⚔️' },
  { value: '3', label: 'Gauls',     emoji: '🏹' },
  { value: '6', label: 'Egyptians', emoji: '🐫' },
  { value: '7', label: 'Huns',      emoji: '🐎' },
  { value: '8', label: 'Spartans',  emoji: '🦅' },
];

export function getProfile(userId) {
  return prepare('SELECT * FROM users WHERE discord_id = ?').get(userId) ?? null;
}

export function upsertProfile(userId, { ign, home_x, home_y, tribe, notify_pledges } = {}) {
  const existing = getProfile(userId);
  const merged = {
    ign:            ign            !== undefined ? ign            : (existing?.ign ?? null),
    home_x:         home_x         !== undefined ? home_x         : (existing?.home_x ?? null),
    home_y:         home_y         !== undefined ? home_y         : (existing?.home_y ?? null),
    tribe:          tribe          !== undefined ? tribe          : (existing?.tribe ?? null),
    notify_pledges: notify_pledges !== undefined ? notify_pledges : (existing?.notify_pledges ?? 0),
  };

  prepare(`
    INSERT INTO users (discord_id, ign, home_x, home_y, tribe, notify_pledges)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      ign            = excluded.ign,
      home_x         = excluded.home_x,
      home_y         = excluded.home_y,
      tribe          = excluded.tribe,
      notify_pledges = excluded.notify_pledges
  `).run(userId, merged.ign, merged.home_x, merged.home_y, merged.tribe, merged.notify_pledges);
}

export function getHomeCoordsString(userId) {
  try {
    const profile = getProfile(userId);
    if (profile?.home_x != null && profile?.home_y != null) {
      return formatCoords(profile.home_x, profile.home_y);
    }
  } catch { /* no profile */ }
  return '';
}

// ── The profile menu (embed + buttons + tribe dropdown) ──────────────────
function buildProfilePayload(userId) {
  const profile = getProfile(userId);
  const tribeMeta = profile?.tribe ? getTribe(profile.tribe) : null;
  const notifyOn = profile?.notify_pledges === 1;

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand.primary)
    .setTitle('👤 My Profile')
    .setDescription('Use the buttons below to set up your profile. Pick your tribe from the dropdown.')
    .addFields(
      { name: 'IGN',         value: profile?.ign   ?? '*not set*', inline: true },
      { name: 'Home Coords', value: (profile?.home_x != null) ? formatCoords(profile.home_x, profile.home_y) : '*not set*', inline: true },
      { name: 'Tribe',       value: tribeMeta ? `${tribeMeta.emoji} ${tribeMeta.name}` : '*not set*', inline: true },
      { name: 'DM Alerts',   value: notifyOn ? '🔔 ON' : '🔕 OFF', inline: true },
    )
    .setFooter({ text: FOOTER });

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('profile:edit-ign').setStyle(ButtonStyle.Primary).setLabel('Set IGN').setEmoji('✏️'),
    new ButtonBuilder().setCustomId('profile:edit-coords').setStyle(ButtonStyle.Primary).setLabel('Set Coords').setEmoji('📍'),
    new ButtonBuilder().setCustomId('notify:toggle').setStyle(ButtonStyle.Secondary).setLabel(notifyOn ? 'DMs ON' : 'DMs OFF').setEmoji(notifyOn ? '🔔' : '🔕'),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId('profile:tribe-select')
    .setPlaceholder(tribeMeta ? `Tribe: ${tribeMeta.name}` : 'Pick your tribe…')
    .addOptions(
      TRIBE_OPTIONS.map(t =>
        new StringSelectMenuOptionBuilder()
          .setValue(t.value)
          .setLabel(t.label)
          .setEmoji(t.emoji)
          .setDefault(profile?.tribe === parseInt(t.value, 10))
      )
    );
  const selectRow = new ActionRowBuilder().addComponents(select);

  return { embeds: [embed], components: [buttonRow, selectRow], ephemeral: true };
}

export async function handleProfileCommand(interaction) {
  await interaction.reply(buildProfilePayload(interaction.user.id));
}

// Backward-compat: panel:profile button still opens the menu
export async function handleProfileButton(interaction) {
  await interaction.reply(buildProfilePayload(interaction.user.id));
}

// ── Set IGN ──────────────────────────────────────────────────────────────
export async function handleEditIgnButton(interaction) {
  const profile = getProfile(interaction.user.id);
  const modal = new ModalBuilder()
    .setCustomId('profile:save-ign')
    .setTitle('Set in-game name');

  const input = new TextInputBuilder()
    .setCustomId('ign')
    .setLabel('In-game name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);

  if (profile?.ign) input.setValue(profile.ign);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleEditIgnModal(interaction) {
  const ign = interaction.fields.getTextInputValue('ign').trim() || null;
  upsertProfile(interaction.user.id, { ign });
  await interaction.reply({ content: `✅ IGN set to **${ign ?? 'cleared'}**.`, ephemeral: true });
}

// ── Set Home Coords ──────────────────────────────────────────────────────
export async function handleEditCoordsButton(interaction) {
  const profile = getProfile(interaction.user.id);
  const modal = new ModalBuilder()
    .setCustomId('profile:save-coords')
    .setTitle('Set home coords');

  const input = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Home coords (e.g. -10|25)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  if (profile?.home_x != null) input.setValue(formatCoords(profile.home_x, profile.home_y));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleEditCoordsModal(interaction) {
  const raw = interaction.fields.getTextInputValue('coords').trim();
  const parsed = parseCoords(raw);
  if (!parsed) {
    return interaction.reply({ content: `❌ Invalid coordinates: \`${raw}\`. Try \`-12|34\`.`, ephemeral: true });
  }
  upsertProfile(interaction.user.id, { home_x: parsed.x, home_y: parsed.y });
  await interaction.reply({ content: `✅ Home coords set to **${formatCoords(parsed.x, parsed.y)}**.`, ephemeral: true });
}

// ── Pick tribe (dropdown) ────────────────────────────────────────────────
export async function handleTribeSelect(interaction) {
  const tribe = parseInt(interaction.values[0], 10);
  upsertProfile(interaction.user.id, { tribe });
  const meta = getTribe(tribe);
  await interaction.reply({ content: `✅ Tribe set to **${meta.emoji} ${meta.name}**.`, ephemeral: true });
}

// ── Notify toggle ────────────────────────────────────────────────────────
export async function handleNotifyToggle(interaction) {
  const profile = getProfile(interaction.user.id);
  const current = profile?.notify_pledges ?? 0;
  const next = current === 1 ? 0 : 1;
  upsertProfile(interaction.user.id, { notify_pledges: next });
  const state = next === 1 ? '🔔 DM notifications **enabled**.' : '🔕 DM notifications **disabled**.';
  await interaction.reply({ content: state, ephemeral: true });
}

// Back-compat shim — old single-modal path no longer used; kept so the router import doesn't break
export async function handleProfileModal(interaction) {
  return interaction.reply({ content: 'This profile flow has been replaced. Run `/profile` again.', ephemeral: true });
}