import {
  EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { COLORS, FOOTER } from '../utils/i18n.js';

const CATEGORIES = [
  { value: 'overview', label: 'Overview',                emoji: '📖', description: 'What the bot does' },
  { value: 'push',     label: 'Resource Push',           emoji: '📦', description: 'Request and pledge resources' },
  { value: 'combat',   label: 'Defense & Combat',        emoji: '⚔️', description: 'Defense, offense, reinforce, urgent' },
  { value: 'scout',    label: 'Scout & Intel',           emoji: '👀', description: 'Request scouts, lookup villages' },
  { value: 'profile',  label: 'Profile',                 emoji: '👤', description: 'Set your IGN, coords, tribe' },
  { value: 'status',   label: 'Status & Leaderboards',   emoji: '📊', description: 'Your dashboard and rankings' },
  { value: 'timer',    label: 'Personal Timer',          emoji: '⏱️', description: 'Recurring reminders for farming' },
];

const PAGES = {
  overview: {
    title: '📖 Welcome to the TotiBot',
    color: COLORS.brand.primary,
    description:
      'This bot helps the alliance coordinate resource pushes, defense calls, scouting, and more.\n\n' +
      '**Two ways to use it:**\n' +
      '• **Buttons** — each channel has a pinned panel with buttons for the main actions\n' +
      '• **Slash commands** — type `/` and pick from the menu\n\n' +
      'Pick a category from the dropdown below to see how each feature works.',
    fields: [
      { name: '🚀 First time?',       value: 'Run `/profile` to set your in-game name, home coords, and tribe. Your home coords will then auto-fill destination fields.' },
      { name: '💡 Quick tips',        value: '• Coords accept any of these: `(-12|34)`, `-12|34`, `-12/34`\n• Amounts accept shorthand: `5k` = 5000, `1.5m` = 1,500,000\n• Times accept: `14:30` (clock) or `in 2h30m` (relative)' },
    ],
  },

  push: {
    title: '📦 Resource Push',
    color: COLORS.brand.success,
    description: 'Request resources from alliance members. They click "I\'ll send" to pledge an amount; the embed updates live with progress.',
    fields: [
      { name: '🪜 How to request',
        value: '**Option A — Panel:** click 🪵 / 🧱 / 🔩 / 🌾 / 📦 in the resources channel\n' +
               '**Option B — Slash:** `/push resource:<r> coords:<x|y> amount:<n> [deadline:<>]`' },
      { name: '✅ How to pledge',
        value: 'On any push embed:\n' +
               '• **✅ I\'ll send** — type how much (adds to your existing pledge)\n' +
               '• **❌ Withdraw** — remove your pledge\n' +
               '• **📦 Send resources** — opens Travian map at the destination' },
      { name: '🔒 Closing',
        value: 'The call auto-closes when fully filled. The original requester can also close it manually.' },
      { name: '📝 Examples',
        value: '`/push resource:lumber coords:-12|34 amount:50k deadline:in 2h`\n' +
               '`/push resource:all coords:0|0 amount:10k` (= 10k of each = 40k total)' },
    ],
  },

  combat: {
    title: '⚔️ Defense & Combat',
    color: COLORS.call.defense,
    description: 'Rally responders for attacks. Defenders click "I\'m sending" with their troop counts.',
    fields: [
      { name: '🛡️ Defense Call',
        value: '**Panel:** click 🛡️ Defense Call · **Slash:** `/defense coords arrival [attacker] [troops]`\n' +
               'Pings `@def-crew` automatically.' },
      { name: '⚔️ Offense Call',
        value: '**Panel:** click ⚔️ Offense Call · **Slash:** `/offense coords arrival [notes]`\n' +
               'No ping — for organizing op participants.' },
      { name: '🤝 Reinforce',
        value: '**Panel:** click 🤝 Reinforce · **Slash:** `/reinforce coords arrival [notes]`\n' +
               'Pings `@def-crew`. For long-term defense, not active attacks.' },
      { name: '🚨 URGENT',
        value: '**Panel only.** Pings `@everyone` AND `@def-crew`. Use sparingly — only for critical defense.' },
      { name: '🎮 Responding',
        value: 'On the embed: **✅ Join** opens a modal for your troop counts (free text, e.g. "5k inf, 200 cav"). **❌ Withdraw** removes you. **🗺️ Map** + **⚔️ Rally Point** open Travian.' },
      { name: '⏰ Auto-expire',
        value: 'Calls automatically grey out after the arrival time passes — they\'re no longer actionable.' },
    ],
  },

  scout: {
    title: '👀 Scout & Intel',
    color: COLORS.call.scout,
    description: 'Request scouts and look up village info from cached map data.',
    fields: [
      { name: '👀 Scout Request',
        value: '**Panel:** click 👀 Scout · **Slash:** `/scout coords [notes]`\n' +
               'Scouts click **👀 On it** to commit, then **📝 Submit Report** to paste their findings inline.' },
      { name: '🔍 Whois Lookup',
        value: '**Panel:** click 🔍 Whois Lookup · **Slash:** `/whois coords:<x|y>`\n' +
               'Returns the village owner, alliance, population, and tribe (when map data is loaded).' },
      { name: '📌 Note',
        value: 'Map data refreshes daily at 06:00. Some villages may be 24h stale.' },
    ],
  },

  profile: {
    title: '👤 Your Profile',
    color: COLORS.brand.primary,
    description: 'Set your in-game name, home coords, and tribe so the bot can auto-fill modals and tag you in DMs.',
    fields: [
      { name: '🚀 Open the menu',
        value: 'Run `/profile` — an ephemeral menu only you can see.' },
      { name: '✏️ Set IGN',
        value: 'Click **Set IGN** → type your in-game name → submit.' },
      { name: '📍 Set Coords',
        value: 'Click **Set Coords** → enter your main village coords (e.g. `-12|34`).\n' +
               'These auto-fill the destination field in push / combat / scout modals.' },
      { name: '🏳️ Set Tribe',
        value: 'Pick from the **dropdown** — Romans / Teutons / Gauls / Egyptians / Huns / Spartans.' },
      { name: '🔔 DM notifications',
        value: 'Click the **DMs** button to toggle. When ON, you\'ll receive a DM each time someone pledges to a call you authored.' },
    ],
  },

  status: {
    title: '📊 Status & Leaderboards',
    color: COLORS.brand.info,
    description: 'See your activity, browse all open calls, and check who\'s leading the alliance stats.',
    fields: [
      { name: '📊 /status',
        value: 'Your personal dashboard:\n' +
               '• Profile summary\n' +
               '• Calls you\'ve authored (with jump links)\n' +
               '• Calls you\'ve pledged on\n' +
               '• Lifetime pledge counts by type' },
      { name: '📋 /calls',
        value: 'Paginated list of every open call across the alliance, with jump links. Use ⬅️ / ➡️ to browse.' },
      { name: '🏆 /leaderboard',
        value: 'Pick a category:\n' +
               '• **Top Pushers** — most resources pledged\n' +
               '• **Top Defenders** — most combat-call responses\n' +
               '• **Top Scouts** — most scout reports submitted\n' +
               '• **Most Active Requesters** — most calls created' },
    ],
  },

  timer: {
    title: '⏱️ Personal Timer',
    color: COLORS.brand.warning,
    description: 'Recurring channel-mention reminder. Each tick auto-deletes after 30 seconds — you keep the ping notification, the channel stays clean.',
    fields: [
      { name: '🚀 Start',
        value: '`/timer set interval:7m`\n' +
               '`/timer set interval:1h30m label:hero-adventures`\n\n' +
               'The bot will mention you in this channel every interval until you stop it.' },
      { name: '⏹️ Stop',
        value: '`/timer stop` — ends your timer. You can only have one active at a time.' },
      { name: '📋 Status',
        value: '`/timer status` — shows your interval, fire count, and next ping time.' },
      { name: '⚙️ Limits',
        value: 'Min 60 seconds · Max 24 hours · One timer per user (running `/timer set` again replaces the previous one).' },
      { name: '💡 Common uses',
        value: '• Farm cycles: `7m`, `12m`\n• Hero adventure cooldowns: `1h`\n• PvP windows: `15m`' },
    ],
  },
};

function buildPayload(category) {
  const page = PAGES[category] ?? PAGES.overview;

  const embed = new EmbedBuilder()
    .setColor(page.color)
    .setTitle(page.title)
    .setDescription(page.description)
    .addFields(page.fields)
    .setFooter({ text: `${FOOTER} · Use the dropdown below to navigate` });

  const select = new StringSelectMenuBuilder()
    .setCustomId('help:category')
    .setPlaceholder('Pick a topic…')
    .addOptions(
      CATEGORIES.map(c =>
        new StringSelectMenuOptionBuilder()
          .setValue(c.value)
          .setLabel(c.label)
          .setEmoji(c.emoji)
          .setDescription(c.description)
          .setDefault(c.value === category)
      )
    );
  const row = new ActionRowBuilder().addComponents(select);

  return { embeds: [embed], components: [row], ephemeral: true };
}

export async function handleHelpCommand(interaction) {
  await interaction.reply(buildPayload('overview'));
}

export async function handleHelpSelect(interaction) {
  const choice = interaction.values[0];
  await interaction.update(buildPayload(choice));
}