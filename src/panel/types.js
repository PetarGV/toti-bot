import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from 'discord.js';
import { ROLE_BUTTON_PREFIX, ROLE_RESET_CUSTOM_ID, ROLE_SELECTIONS } from '../utils/roleSelection.js';

export const PANEL_TYPES = ['offense', 'resources', 'scout', 'general', 'roles', 'timer', 'reports', 'def-calls', 'leadership'];

const COLOR = {
  defense:     0xe74c3c,
  offense:     0x992d22,
  resources:   0x2ecc71,
  scout:       0x3498db,
  general:     0x9b59b6,
  roles:       0x5865f2,
  timer:       0xf1c40f,
  reports:     0xe67e22,
  'def-calls': 0xe74c3c,
  leadership:  0x1abc9c,
};

function btn(customId, label, emoji, style = ButtonStyle.Secondary) {
  const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) button.setEmoji(emoji);
  return button;
}

const ROLE_BUTTON_META = {
  def:    { emoji: '🟢', style: ButtonStyle.Success },
  off:    { emoji: '🔴', style: ButtonStyle.Danger },
  scout:  { emoji: '🔵', style: ButtonStyle.Primary },
  hybrid: { emoji: '🟠', style: ButtonStyle.Secondary },
  wwk:    { emoji: '⚫', style: ButtonStyle.Secondary },
};

function getRoleSelection(value) {
  return ROLE_SELECTIONS.find((selection) => selection.value === value);
}

function roleButton(selection) {
  const meta = ROLE_BUTTON_META[selection.value] ?? {};
  return btn(
    `${ROLE_BUTTON_PREFIX}:${selection.value}`,
    selection.label,
    meta.emoji,
    meta.style ?? ButtonStyle.Secondary,
  );
}

function roleButtonRow(values) {
  return new ActionRowBuilder().addComponents(
    ...values.map((value) => roleButton(getRoleSelection(value))),
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
  offense:   '⚔️ Offense Operations',
  resources: '📦 Resource Push',
  scout:     '🔍 Scouting & Intel',
  general:   '📊 Status & Overview',
  roles:     'Choose Your Crew Role',
  timer:       '⏱️ Timer Control',
  reports:     '📥 Incoming Attack Reports',
  'def-calls': '🛡️ Defense Calls',
  leadership:  '🧠 Leadership Intel',
};

const descriptions = {
  offense:   'Coordinate offensive operations. Look up targets and post offense calls.',
  resources: 'Request resource pushes from alliance members. Select the resource type to get started.',
  scout:     'Request scouts, look up villages, or report enemy sightings.',
  general:   'View active calls, check your profile, and manage your settings.',
  roles:     [
    'Select the assignment that matches how you play.',
    '🟢 Def Crew   🔴 Off Crew   🔵 Scout Crew',
    '🟠 Hybrid gives Def Crew too. ⚫ WWK is separate.',
    'Reset removes every crew role.',
  ].join('\n'),
  timer: [
    'Personal recurring reminder. Pick a preset to start, or use Custom… for any interval.',
    'Pause keeps the time left in the current cycle; Resume picks up from there. Stop clears your timer.',
    '*Your timer is private — clicks reply only to you.*',
  ].join('\n'),
  reports:     'Report incoming attacks. Leadership + Defense Coordinator will be pinged automatically.',
  'def-calls': 'Active and Perma Def calls. Members respond with Sending Def. Buttons restricted to Leadership / Defense Coordinator.',
  leadership:  'Pinned intelligence dashboard. Drill down by target or attacker, widen the time window, or refresh.',
};

const footers = {
  roles: 'You can change your selection later from this menu.',
  timer: 'Your timer is private — each click replies only to you.',
};

const rowBuilders = {
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
    roleButtonRow(['def', 'off', 'scout']),
    roleButtonRow(['hybrid', 'wwk']),
    new ActionRowBuilder().addComponents(
      btn(ROLE_RESET_CUSTOM_ID, 'Reset Crew Roles', '♻️', ButtonStyle.Danger),
    ),
  ],

  timer: () => [
    new ActionRowBuilder().addComponents(
      btn('timer:preset:7m',  '7m',         '⏱️'),
      btn('timer:preset:10m', '10m',        '⏱️'),
      btn('timer:preset:13m', '13m',        '⏱️'),
      btn('timer:custom',     'Custom…',    '⚙️', ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      btn('timer:pause',  'Pause',  '⏸️'),
      btn('timer:stop',   'Stop',   '⏹️', ButtonStyle.Danger),
      btn('timer:status', 'Status', '📊'),
    ),
  ],

  reports: () => [
    new ActionRowBuilder().addComponents(
      btn('report:choose', 'Report Incoming', '📢', ButtonStyle.Danger),
    ),
  ],

  'def-calls': () => [
    new ActionRowBuilder().addComponents(
      btn('call:def_active', 'Active Def', '🛡️', ButtonStyle.Danger),
      btn('call:def_perma',  'Perma Def',  '🛡️', ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      btn('panel:calls', 'Active Calls', '📋'),
    ),
  ],

  leadership: () => [
    new ActionRowBuilder().addComponents(
      btn('intel:refresh',  'Refresh',             '🔄', ButtonStyle.Secondary),
      btn('intel:target',   'Target drill-down',   '🎯', ButtonStyle.Secondary),
      btn('intel:attacker', 'Attacker drill-down', '⚔️', ButtonStyle.Secondary),
      btn('intel:window',   'Wider window',        '📅', ButtonStyle.Secondary),
    ),
  ],
};
