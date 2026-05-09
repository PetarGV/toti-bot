import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { ROLE_SELECTIONS, ROLE_SELECT_CUSTOM_ID } from '../utils/roleSelection.js';

export const PANEL_TYPES = ['defense', 'offense', 'resources', 'scout', 'general', 'roles'];

const COLOR = {
  defense:   0xe74c3c,
  offense:   0x992d22,
  resources: 0x2ecc71,
  scout:     0x3498db,
  general:   0x9b59b6,
  roles:     0xf1c40f,
};

function btn(customId, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

function rolesSelect() {
  return new StringSelectMenuBuilder()
    .setCustomId(ROLE_SELECT_CUSTOM_ID)
    .setPlaceholder('Choose your crew role')
    .addOptions(
      ROLE_SELECTIONS.map((selection) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(selection.label)
          .setValue(selection.value)
          .setDescription(selection.description),
      ),
    );
}

export function buildPanel(type) {
  const embed = new EmbedBuilder()
    .setColor(COLOR[type] ?? 0x95a5a6)
    .setTitle(titles[type])
    .setDescription(descriptions[type])
    .setFooter({ text: footers[type] ?? 'Click a button to open a request form' })
    .setTimestamp();

  const rows = rowBuilders[type]();
  return { embeds: [embed], components: rows };
}

const titles = {
  defense:   '🛡️ Defense Operations',
  offense:   '⚔️ Offense Operations',
  resources: '📦 Resource Push',
  scout:     '🔍 Scouting & Intel',
  general:   '📊 Status & Overview',
  roles:     'Choose Your Crew Role',
};

const descriptions = {
  defense:   'Call for defense, request reinforcements, or escalate to URGENT for critical attacks.',
  offense:   'Coordinate offensive operations. Look up targets and post offense calls.',
  resources: 'Request resource pushes from alliance members. Select the resource type to get started.',
  scout:     'Request scouts, look up villages, or report enemy sightings.',
  general:   'View active calls, check your profile, and manage your settings.',
  roles:     'Pick the crew role that matches how you play. Hybrid also grants Def Crew.',
};

const footers = {
  roles: 'You can change your selection later from this menu.',
};

const rowBuilders = {
  defense: () => [
    new ActionRowBuilder().addComponents(
      btn('call:defense', 'Defense Call', '🛡️', ButtonStyle.Danger),
      btn('call:urgent',  'URGENT',       '🚨', ButtonStyle.Danger),
      btn('call:reinforce', 'Reinforce',  '🤝'),
    ),
    new ActionRowBuilder().addComponents(
      btn('panel:calls',    'Active Calls', '📋'),
    ),
  ],

  offense: () => [
    new ActionRowBuilder().addComponents(
      btn('call:offense', 'Offense Call', '⚔️', ButtonStyle.Danger),
      btn('intel:whois',  'Whois Lookup', '🔍'),
      btn('panel:calls',  'Active Calls', '📋'),
    ),
  ],

  resources: () => [
    new ActionRowBuilder().addComponents(
      btn('push:lumber', 'Lumber', '🪵'),
      btn('push:clay',   'Clay',   '🧱'),
      btn('push:iron',   'Iron',   '🔩'),
      btn('push:crop',   'Crop',   '🌾'),
    ),
    new ActionRowBuilder().addComponents(
      btn('push:all',    'All Resources', '📦', ButtonStyle.Primary),
      btn('panel:calls', 'Active Calls',  '📋'),
    ),
  ],

  scout: () => [
    new ActionRowBuilder().addComponents(
      btn('call:scout',   'Scout Request', '👀'),
      btn('intel:whois',  'Whois Lookup',  '🔍'),
      btn('intel:report', 'Report Sighting','📍'),
    ),
    new ActionRowBuilder().addComponents(
      btn('panel:calls', 'Active Calls', '📋'),
    ),
  ],

  general: () => [
    new ActionRowBuilder().addComponents(
      btn('panel:status', 'My Status',    '📊'),
      btn('panel:calls',  'Active Calls', '📋'),
      btn('panel:profile','My Profile',   '⚙️'),
      btn('general:nearby', 'Nearby Map', '🗺️'),
    ),
  ],

  roles: () => [
    new ActionRowBuilder().addComponents(rolesSelect()),
  ],
};
