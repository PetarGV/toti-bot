import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { langChoices } from '../utils/translation/locales.js';
import { isEnabled, COMMAND_FEATURES, PANEL_FEATURES } from '../utils/features.js';

const SETUP_SUBCOMMANDS = [
  { name: 'reports', description: 'Incoming attack reports panel' },
  { name: 'leadership', description: 'Intel dashboard panel (leadership channel)' },
  { name: 'offense', description: 'Offense operations panel' },
  { name: 'scout', description: 'Scouting & intel panel' },
  { name: 'resources', description: 'Resource push panel' },
  { name: 'general', description: 'Status & overview panel' },
  { name: 'roles', description: 'Crew role selection panel' },
  { name: 'timer', description: 'Personal timer control panel' },
];

const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Post a pinned panel in this channel (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
for (const { name, description } of SETUP_SUBCOMMANDS) {
  if (!isEnabled(PANEL_FEATURES[name])) continue;
  setupCommand.addSubcommand(s => s.setName(name).setDescription(description));
}

export const commandDefinitions = [
  // ── Admin ───────────────────────────────────────────────────────────────
  setupCommand,

  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s =>
      s.setName('set-server')
        .setDescription('Update the Travian server URL')
        .addStringOption(o =>
          o.setName('url').setDescription('Full server URL (e.g. https://ts2.x1.international.travian.com)').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('reset-round')
        .setDescription('Wipe map data and calls for a new server round')
    )
    .addSubcommand(s =>
      s.setName('fetch-map')
        .setDescription('Manually trigger a map.sql fetch')
    )
    .addSubcommand(s => s.setName('map-status').setDescription('Show map data status'))
    .addSubcommand(s =>
      s.setName('sync-members')
        .setDescription('Match Discord member names against Travian map players')
        .addBooleanOption(o =>
          o.setName('update-profiles')
            .setDescription('Fill missing bot profiles from unique matches (default: true)')
            .setRequired(false)
        )
    )
    .addSubcommand(s =>
      s.setName('link')
        .setDescription('Link a Discord user to a Travian IGN (as a secondary link)')
        .addUserOption(o => o.setName('discord').setDescription('Discord user').setRequired(true))
        .addStringOption(o => o.setName('ign').setDescription('Exact Travian in-game name').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('unlink')
        .setDescription('Remove a Discord ↔ IGN link')
        .addUserOption(o => o.setName('discord').setDescription('Discord user').setRequired(true))
        .addStringOption(o => o.setName('ign').setDescription('Travian IGN to unlink').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('set-primary')
        .setDescription('Set which of a user\'s linked IGNs is their primary')
        .addUserOption(o => o.setName('discord').setDescription('Discord user').setRequired(true))
        .addStringOption(o => o.setName('ign').setDescription('IGN to mark as primary').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('set-def-calls-channel')
        .setDescription('Set the channel where Active Def and Perma Def call embeds are posted')
        .addChannelOption(o => o.setName('channel').setDescription('Def calls channel').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('set-leadership-channel')
        .setDescription('Set the channel where incoming attack reports are posted (separate from /setup leadership)')
        .addChannelOption(o => o.setName('channel').setDescription('Leadership reports channel').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('set-welcome-channel')
        .setDescription('Set the channel where new members get the onboarding greeting')
        .addChannelOption(o => o.setName('channel').setDescription('Welcome channel').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('set-notifications-channel')
        .setDescription('Set the channel for bot notifications (sync results, map fetch errors)')
        .addChannelOption(o => o.setName('channel').setDescription('Notifications channel').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('set-onboarding-category')
        .setDescription('Set the category where a private channel is created for each new member')
        .addChannelOption(o =>
          o.setName('category')
            .setDescription('Category to create private channels in')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory)
        )
    )
    .addSubcommand(s =>
      s.setName('set-coords')
        .setDescription('Set home village coords for a user (auto-derives tribe + assigns Discord role)')
        .addUserOption(o => o.setName('discord').setDescription('Discord user').setRequired(true))
        .addStringOption(o => o.setName('coords').setDescription('Village coords (e.g. -12|34)').setRequired(true))
    )
    .addSubcommand(s => s.setName('diag').setDescription('Show bot diagnostics (uptime, memory, DB size)'))
    .addSubcommand(s =>
      s.setName('tail-log')
        .setDescription('Show last N log lines')
        .addIntegerOption(o => o.setName('lines').setDescription('Number of lines (max 200)').setRequired(false))
    )
    .addSubcommand(s => s.setName('db-vacuum').setDescription('Compact the database file'))
    .addSubcommand(s => s.setName('backup-now').setDescription('Run a database backup immediately'))
    .addSubcommand(s =>
      s.setName('check')
        .setDescription('Inspect a member\'s linked IGN, map alliance, and which roles they\'d get')
        .addUserOption(o => o.setName('discord').setDescription('Discord user').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('map-search')
        .setDescription('Look up a player name directly in the Travian map data')
        .addStringOption(o => o.setName('ign').setDescription('Player name (partial match)').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('sync-exclude')
        .setDescription('Exclude a member from automatic sync (they will never be auto-linked)')
        .addUserOption(o => o.setName('discord').setDescription('Discord user').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('sync-unexclude')
        .setDescription('Remove a member from the sync exclusion list')
        .addUserOption(o => o.setName('discord').setDescription('Discord user').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('sync-excluded-list')
        .setDescription('Show all members currently excluded from automatic sync')
    )
    .addSubcommand(s =>
      s.setName('onboarding-status')
        .setDescription('List members with incomplete onboarding (missing IGN, crew role, or coords)')
    )
    .addSubcommand(s =>
      s.setName('push-report')
        .setDescription('Detailed resource-push history: who pushed how much to which push')
        .addUserOption(o => o.setName('requester').setDescription('Only show pushes requested by this user').setRequired(false))
    ),

  // ── Slash mirrors of panel buttons ──────────────────────────────────────
  new SlashCommandBuilder()
    .setName('push')
    .setDescription('Request a resource push')
    .addStringOption(o =>
      o.setName('resource')
        .setDescription('Resource type')
        .setRequired(true)
        .addChoices(
          { name: 'Lumber', value: 'lumber' },
          { name: 'Clay',   value: 'clay' },
          { name: 'Iron',   value: 'iron' },
          { name: 'Crop',   value: 'crop' },
          { name: 'All',    value: 'all' },
        )
    )
    .addStringOption(o => o.setName('coords').setDescription('Your village coords e.g. -10|25').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount needed').setRequired(true))
    .addStringOption(o => o.setName('deadline').setDescription('Deadline e.g. 14:30 or "in 2h"')),

  new SlashCommandBuilder()
    .setName('report-incoming')
    .setDescription('Submit an incoming attack report')
    .addStringOption(o => o.setName('defender').setDescription('Defender coordinates').setRequired(true))
    .addStringOption(o => o.setName('attacker').setDescription('Attacker coordinates').setRequired(true))
    .addStringOption(o => o.setName('first_eta').setDescription('First wave ETA (UTC)').setRequired(true))
    .addIntegerOption(o => o.setName('waves').setDescription('Number of waves (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addIntegerOption(o => o.setName('wave_spread_sec').setDescription('Seconds from first to last wave').setRequired(false).setMinValue(0).setMaxValue(3600))
    .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false)),

  new SlashCommandBuilder()
    .setName('active-def')
    .setDescription('Post an Active Def call (leadership only)')
    .addStringOption(o => o.setName('coords').setDescription('Defender coordinates').setRequired(true))
    .addIntegerOption(o => o.setName('troops_needed').setDescription('Required def value').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('arrival').setDescription('Impact time (UTC) — type or pick a suggestion').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false)),

  new SlashCommandBuilder()
    .setName('perma-def')
    .setDescription('Post a Perma Def call (leadership only)')
    .addStringOption(o => o.setName('coords').setDescription('Defender coordinates').setRequired(true))
    .addIntegerOption(o => o.setName('troops_needed').setDescription('Required def value').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false)),

  new SlashCommandBuilder()
    .setName('sending-def')
    .setDescription('Pledge inf/cav to a def call')
    .addIntegerOption(o => o.setName('call').setDescription('Call ID').setRequired(true))
    .addIntegerOption(o => o.setName('inf').setDescription('Infantry').setRequired(true).setMinValue(0))
    .addIntegerOption(o => o.setName('cav').setDescription('Cavalry').setRequired(true).setMinValue(0)),

  new SlashCommandBuilder()
    .setName('intel')
    .setDescription('Intelligence dashboard / drill-down (leadership only)')
    .addIntegerOption(o => o.setName('days').setDescription('Widen window to N days (1-30)').setMinValue(1).setMaxValue(30).setRequired(false))
    .addStringOption(o => o.setName('target').setDescription('Defender coords for drill-down').setRequired(false))
    .addStringOption(o => o.setName('attacker').setDescription('Attacker coords for drill-down').setRequired(false)),

  new SlashCommandBuilder()
    .setName('reclassify')
    .setDescription('Reclassify a report (leadership only)')
    .addIntegerOption(o => o.setName('report').setDescription('Report ID').setRequired(true))
    .addStringOption(o => o.setName('as').setDescription('Classification').setRequired(true)
      .addChoices(
        { name: 'fake', value: 'fake' },
        { name: 'real', value: 'real' },
        { name: 'chief', value: 'chief' },
        { name: 'auto', value: 'auto' },
      )),

  new SlashCommandBuilder()
    .setName('offense')
    .setDescription('Post an offense call')
    .addStringOption(o => o.setName('coords').setDescription('Target coords').setRequired(true))
    .addStringOption(o => o.setName('arrival').setDescription('Desired arrival time').setRequired(true))
    .addStringOption(o => o.setName('notes').setDescription('Additional notes')),

  new SlashCommandBuilder()
    .setName('scout')
    .setDescription('Request a scout on a village')
    .addStringOption(o => o.setName('coords').setDescription('Target coords').setRequired(true))
    .addStringOption(o => o.setName('notes').setDescription('What to look for'))
    .addStringOption(o => o.setName('min-scouts').setDescription('Minimum scouts needed, e.g. 50, 200, 500+')),

  new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Look up a village from map data')
    .addStringOption(o => o.setName('coords').setDescription('Village coords').setRequired(true)),

  new SlashCommandBuilder()
    .setName('nearby')
    .setDescription('Find villages near coordinates from map data')
    .addStringOption(o => o.setName('coords').setDescription('Center coords').setRequired(true))
    .addIntegerOption(o =>
      o.setName('radius')
        .setDescription('Search radius in fields, 1-50')
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('limit')
        .setDescription('Max nearby villages, 1-40')
        .setMinValue(1)
        .setMaxValue(40)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show your profile and active calls'),

  new SlashCommandBuilder()
    .setName('calls')
    .setDescription('List all active calls'),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your alliance profile'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('How to use the bot — interactive guide'),

  new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text with DeepL')
    .addStringOption(o =>
      o.setName('text')
        .setDescription('Text to translate')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('to')
        .setDescription('Target language')
        .setRequired(false)
        .addChoices(...langChoices())
    ),

  new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Personal recurring reminder')
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Start or replace your timer')
        .addStringOption(o => o.setName('interval').setDescription('Interval (e.g. 7m, 1h30m, 90s)').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription('Optional label').setRequired(false))
    )
    .addSubcommand(s => s.setName('stop').setDescription('Stop your timer'))
    .addSubcommand(s => s.setName('status').setDescription('Show your timer status')),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show alliance leaderboards')
    .addStringOption(o =>
      o.setName('category')
        .setDescription('Which leaderboard to show')
        .setRequired(false)
        .addChoices(
          { name: 'Top Pushers',            value: 'pushers' },
          { name: 'Top Defenders',          value: 'defenders' },
          { name: 'Top Scouts',             value: 'scouts' },
          { name: 'Most Active Requesters', value: 'requesters' },
        )
    ),
]
  .filter(c => isEnabled(COMMAND_FEATURES[c.name]))
  .map(c => c.toJSON());
