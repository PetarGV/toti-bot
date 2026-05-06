import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const commandDefinitions = [
  // ── Admin ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Post a pinned panel in this channel (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(s => s.setName('defense').setDescription('Defense operations panel'))
    .addSubcommand(s => s.setName('offense').setDescription('Offense operations panel'))
    .addSubcommand(s => s.setName('scout').setDescription('Scouting & intel panel'))
    .addSubcommand(s => s.setName('resources').setDescription('Resource push panel'))
    .addSubcommand(s => s.setName('general').setDescription('Status & overview panel')),

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
    .addSubcommand(s => s.setName('diag').setDescription('Show bot diagnostics (uptime, memory, DB size)'))
    .addSubcommand(s =>
      s.setName('tail-log')
        .setDescription('Show last N log lines')
        .addIntegerOption(o => o.setName('lines').setDescription('Number of lines (max 200)').setRequired(false))
    )
    .addSubcommand(s => s.setName('db-vacuum').setDescription('Compact the database file'))
    .addSubcommand(s => s.setName('backup-now').setDescription('Run a database backup immediately')),

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
    .setName('defense')
    .setDescription('Post a defense call')
    .addStringOption(o => o.setName('coords').setDescription('Village under attack coords').setRequired(true))
    .addStringOption(o => o.setName('arrival').setDescription('Attack arrival time e.g. 14:30 or "in 1h30m"').setRequired(true))
    .addStringOption(o => o.setName('attacker').setDescription('Attacker name / alliance'))
    .addStringOption(o => o.setName('troops').setDescription('Troops needed (free text, e.g. "5k phalanx")')),

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
    .addStringOption(o => o.setName('notes').setDescription('What to look for')),

  new SlashCommandBuilder()
    .setName('reinforce')
    .setDescription('Request reinforcements')
    .addStringOption(o => o.setName('coords').setDescription('Village coords').setRequired(true))
    .addStringOption(o => o.setName('arrival').setDescription('Needed by time').setRequired(true))
    .addStringOption(o => o.setName('notes').setDescription('Notes')),

  new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Look up a village from map data')
    .addStringOption(o => o.setName('coords').setDescription('Village coords').setRequired(true)),

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
].map(c => c.toJSON());
