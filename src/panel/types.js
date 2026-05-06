import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} from 'discord.js';

export const PANEL_TYPES = ['defense', 'resources', 'intel', 'general'];

const COLOR = {
  defense:   0xe74c3c,
  resources: 0x2ecc71,
  intel:     0x3498db,
  general:   0x9b59b6,
};

function btn(customId, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

function linkBtn(label, emoji, url) {
  return new ButtonBuilder().setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link).setURL(url);
}

export function buildPanel(type) {
  const embed = new EmbedBuilder()
    .setColor(COLOR[type] ?? 0x95a5a6)
    .setTitle(titles[type])
    .setDescription(descriptions[type])
    .setFooter({ text: 'Click a button to open a request form' })
    .setTimestamp();

  const rows = rowBuilders[type]();
  return { embeds: [embed], components: rows };
}

const titles = {
  defense:   '⚔️ Defense & Combat Operations',
  resources: '📦 Resource Push',
  intel:     '🔍 Intelligence & Scouting',
  general:   '📊 Status & Overview',
};

const descriptions = {
  defense:   'Use the buttons below to call for defense, launch attacks, or request reinforcements.',
  resources: 'Request resource pushes from alliance members. Select the resource type to get started.',
  intel:     'Request scouts, look up villages, or report enemy sightings.',
  general:   'View active calls, check your profile, and manage your settings.',
};

const rowBuilders = {
  defense: () => [
    new ActionRowBuilder().addComponents(
      btn('call:defense', 'Defense Call', '🛡️', ButtonStyle.Danger),
      btn('call:offense', 'Offense Call', '⚔️', ButtonStyle.Danger),
      btn('call:urgent',  'URGENT',       '🚨', ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      btn('call:reinforce', 'Reinforce',    '🤝'),
      btn('call:scout',     'Scout',        '👀'),
      btn('panel:calls',    'Active Calls', '📋'),
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

  intel: () => [
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
    ),
  ],
};
