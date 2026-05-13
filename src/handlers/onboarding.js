import { CREW_ROLE_NAMES, ROLE_SELECTIONS, ROLE_BUTTON_PREFIX } from '../utils/roleSelection.js';
import { getPrimaryLinkForUser, setUserIgnFromInput, getAllLinksForUser } from './userIgnLinks.js';
import { prepare, getConfig, transaction } from '../db/client.js';
import { parseCoords } from '../utils/coords.js';
import { setAccountCoords, upsertAccountFromMap } from './travianAccounts.js';
import { matchMemberToPlayer, getTravianPlayersFromMap } from '../utils/memberMapMonitor.js';
import { assignRolesFromIgn } from './memberRoles.js';
import { logger } from '../utils/logger.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits,
} from 'discord.js';

const LEADERSHIP_ROLE_NAMES = ['Cesar', 'Imperators'];

async function createMemberOnboardingChannel(member) {
  const categoryId = getConfig('onboarding_category_id');
  if (!categoryId) return null;

  const safeName = member.displayName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'member';
  const channelName = `welcome-${safeName}`;

  const leadershipRoles = LEADERSHIP_ROLE_NAMES
    .map(name => member.guild.roles.cache.find(r => r.name === name))
    .filter(Boolean);

  const permissionOverwrites = [
    { id: member.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    ...leadershipRoles.map(role => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    })),
  ];

  try {
    const channel = await member.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites,
      topic: `Onboarding | Discord: ${member.displayName} | IGN: (pending)`,
    });
    prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(member.id);
    prepare('UPDATE users SET onboarding_channel_id = ? WHERE discord_id = ?').run(channel.id, member.id);
    logger.info(`guildMemberAdd: created private channel #${channelName} for ${member.user.tag}`);
    return channel;
  } catch (err) {
    logger.error(`guildMemberAdd: failed to create onboarding channel for ${member.user.tag}: ${err.message}`);
    return null;
  }
}

function safeChannelName(ign) {
  return ign
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'member';
}

export async function renameOnboardingChannel(discordId, ign, guild) {
  const row = prepare('SELECT onboarding_channel_id FROM users WHERE discord_id = ?').get(discordId);
  if (!row?.onboarding_channel_id) return;
  try {
    const channel = await guild.channels.fetch(row.onboarding_channel_id);
    if (channel) await channel.setName(safeChannelName(ign));
  } catch (err) {
    logger.warn(`renameOnboardingChannel: ${discordId} → ${ign}: ${err.message}`);
  }
}

export async function updateOnboardingChannelTopic(discordId, ign, guild) {
  const row = prepare('SELECT onboarding_channel_id FROM users WHERE discord_id = ?').get(discordId);
  if (!row?.onboarding_channel_id) return;
  try {
    const channel = await guild.channels.fetch(row.onboarding_channel_id);
    if (!channel) return;
    const guildMember = await guild.members.fetch(discordId).catch(() => null);
    const displayName = guildMember?.displayName ?? discordId;
    await channel.setTopic(`Onboarding | Discord: ${displayName} | IGN: ${ign}`);
  } catch (err) {
    logger.warn(`updateOnboardingChannelTopic: ${discordId} → ${ign}: ${err.message}`);
  }
}

export async function flagOnboardingChannel(discordId, reason, guild) {
  const row = prepare('SELECT onboarding_channel_id FROM users WHERE discord_id = ?').get(discordId);
  if (!row?.onboarding_channel_id) return;
  try {
    const channel = await guild.channels.fetch(row.onboarding_channel_id).catch(() => null);
    if (!channel) return;

    const currentName = channel.name ?? '';
    if (!currentName.startsWith('review-')) {
      await channel.setName(`review-${currentName.slice(0, 93)}`);
    }

    const { mentionString, memberIds } = buildLeadershipMentions(guild);
    const lines = [];
    if (mentionString) lines.push(mentionString);
    lines.push(`⚠️ **Action required** — ${reason}`);

    await channel.send({
      content: lines.join('\n'),
      allowedMentions: { users: memberIds },
    });

    logger.info(`flagOnboardingChannel: flagged ${discordId} — ${reason}`);
  } catch (err) {
    logger.warn(`flagOnboardingChannel: ${discordId}: ${err.message}`);
  }
}

export async function handleGuildMemberRemove(member) {
  if (member.user?.bot) return;
  await flagOnboardingChannel(member.id, `<@${member.id}> (${member.user?.tag ?? member.id}) left the server`, member.guild);
}

function hasCrewRole(memberRoleNames) {
  const lowered = new Set((memberRoleNames ?? []).map(n => String(n).trim().toLowerCase()));
  return CREW_ROLE_NAMES.some(name => lowered.has(name.toLowerCase()));
}

export function getNextStep({ discordId, memberRoleNames }) {
  const primary = getPrimaryLinkForUser(discordId);
  if (!primary) return 'ign';
  if (!hasCrewRole(memberRoleNames)) return 'role';
  if (primary.home_x == null) return 'coords';
  return 'done';
}

export async function applyCoordsAndDeriveTribe({ discordId, coordsString, member }) {
  const parsed = parseCoords(coordsString);
  if (!parsed) return { ok: false, reason: 'invalid_coords' };

  const village = prepare('SELECT player, tid FROM x_world WHERE x = ? AND y = ? LIMIT 1').get(parsed.x, parsed.y);
  if (!village) return { ok: false, reason: 'no_village' };
  if (village.tid === 4 || village.tid === 5) return { ok: false, reason: 'npc_village' };

  const primary = getPrimaryLinkForUser(discordId);
  if (!primary) return { ok: false, reason: 'no_primary' };

  const normalize = (s) => String(s ?? '').trim().toLowerCase();
  if (normalize(village.player) !== normalize(primary.ign)) {
    return { ok: false, reason: 'wrong_owner', villageOwner: village.player, primaryIgn: primary.ign };
  }

  setAccountCoords(primary.ign, parsed.x, parsed.y);

  const roles = await assignRolesFromIgn({ member, ign: primary.ign });
  return {
    ok: true,
    tribeName: roles.tribeName ?? 'Unknown',
    roleAssigned: roles.tribeAssigned,
    allianceAssigned: roles.allianceAssigned,
    allianceRoleName: roles.allianceRoleName,
  };
}

function ignStepPayload(discordId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('onboard:set-ign').setStyle(ButtonStyle.Primary).setLabel('✏️ Set IGN'),
    new ButtonBuilder().setCustomId(`onboard:skip:${discordId}`).setStyle(ButtonStyle.Secondary).setLabel('Skip for now'),
  );
  return {
    content: '👋 **Step 1 of 3 — Set your in-game name.**\nUse the exact Travian name shown on the map.',
    components: [row],
    ephemeral: true,
  };
}

function roleStepPayload(discordId) {
  const roleRow = new ActionRowBuilder().addComponents(
    ...ROLE_SELECTIONS.slice(0, 5).map(s =>
      new ButtonBuilder()
        .setCustomId(`${ROLE_BUTTON_PREFIX}:${s.value}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(s.label),
    ),
  );
  const advanceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`onboard:advance:${discordId}`).setStyle(ButtonStyle.Success).setLabel('Continue ➡'),
    new ButtonBuilder().setCustomId(`onboard:skip:${discordId}`).setStyle(ButtonStyle.Secondary).setLabel('Skip for now'),
  );
  return {
    content: '🎯 **Step 2 of 3 — Pick your crew role.**\nPick one, then click **Continue**.',
    components: [roleRow, advanceRow],
    ephemeral: true,
  };
}

function coordsStepPayload(discordId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('onboard:set-coords').setStyle(ButtonStyle.Primary).setLabel('📍 Set Coords'),
    new ButtonBuilder().setCustomId(`onboard:skip:${discordId}`).setStyle(ButtonStyle.Secondary).setLabel('Skip for now'),
  );
  return {
    content: '📍 **Step 3 of 3 — Set your home village coords.**\nWe\'ll use the village at those coords to determine your tribe and assign the matching role.',
    components: [row],
    ephemeral: true,
  };
}

function donePayload() {
  return {
    content: '🎉 **You\'re all set!** Run `/profile` to see your setup, or `/help` for what the bot can do. Ask an admin if anything needs to change.',
    components: [],
    ephemeral: true,
  };
}

export function buildWizardPayload({ step, discordId }) {
  switch (step) {
    case 'ign':    return ignStepPayload(discordId);
    case 'role':   return roleStepPayload(discordId);
    case 'coords': return coordsStepPayload(discordId);
    default:       return donePayload();
  }
}

export async function handleOnboardStartButton(interaction) {
  const [, , targetId] = interaction.customId.split(':');
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: 'This onboarding is for someone else. Run `/profile` to set up your own.', ephemeral: true });
  }
  const memberRoleNames = interaction.member?.roles?.cache
    ? Array.from(interaction.member.roles.cache.values()).map(r => r.name)
    : [];
  const step = getNextStep({ discordId: targetId, memberRoleNames });
  return interaction.reply(buildWizardPayload({ step, discordId: targetId }));
}

export async function handleOnboardAdvanceButton(interaction) {
  const [, , targetId] = interaction.customId.split(':');
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: 'Not your onboarding session.', ephemeral: true });
  }
  const memberRoleNames = interaction.member?.roles?.cache
    ? Array.from(interaction.member.roles.cache.values()).map(r => r.name)
    : [];
  const step = getNextStep({ discordId: targetId, memberRoleNames });
  return interaction.update(buildWizardPayload({ step, discordId: targetId }));
}

export async function handleOnboardSkipButton(interaction) {
  const [, , targetId] = interaction.customId.split(':');
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: 'Not your onboarding session.', ephemeral: true });
  }
  return interaction.update({
    content: 'No problem — finish later with `/profile`. Ask an admin if you need help.',
    components: [],
  });
}

export async function handleOnboardSetIgnButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('onboard:save-ign')
    .setTitle('Set in-game name');
  const input = new TextInputBuilder()
    .setCustomId('ign')
    .setLabel('Exact Travian name (case-insensitive)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleOnboardSaveIgnModal(interaction) {
  const raw = interaction.fields.getTextInputValue('ign').trim();
  const result = setUserIgnFromInput(interaction.user.id, raw);
  if (!result.ok) {
    const msg = result.reason === 'not_found'
      ? `❌ \`${raw}\` isn't a player on the current map. Use your exact in-game name.`
      : result.reason === 'ambiguous'
        ? `❌ Multiple Travian players match \`${raw}\`. Ask an admin to link you with \`/admin link\`.`
        : `❌ Could not set IGN.`;
    return interaction.reply({ content: msg, ephemeral: true });
  }
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  let roleNote = '';
  if (member) {
    const roles = await assignRolesFromIgn({ member, ign: result.canonical });
    const parts = [];
    if (roles.tribeAssigned) parts.push(`tribe role **${roles.tribeName}**`);
    if (roles.allianceAssigned) parts.push(`**${roles.allianceRoleName}** role`);
    if (parts.length) roleNote = ` ${parts.join(' and ')} assigned.`;
    if (interaction.guild) {
      await renameOnboardingChannel(interaction.user.id, result.canonical, interaction.guild);
      await updateOnboardingChannelTopic(interaction.user.id, result.canonical, interaction.guild);
    }
  }
  return interaction.reply({ content: `✅ IGN set to **${result.canonical}**.${roleNote} Click **Continue ➡** on the wizard to move to Step 2.`, ephemeral: true });
}

export async function handleOnboardSetCoordsButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('onboard:save-coords')
    .setTitle('Set home village coords');
  const input = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Home coords (e.g. -10|25)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export function buildWelcomePayload({ memberId, rolesPanelUrl, autoIgn, autoRoles }) {
  const lines = [`👋 Welcome <@${memberId}>!`, ''];

  if (autoIgn) {
    const parts = [];
    if (autoRoles?.tribeAssigned) parts.push(`tribe role **${autoRoles.tribeName}**`);
    if (autoRoles?.allianceAssigned) parts.push(`**${autoRoles.allianceRoleName}** role`);
    const roleNote = parts.length ? ` ${parts.join(' and ')} assigned.` : '';
    lines.push(`✅ Found your Travian account **${autoIgn}**.${roleNote}`);
    lines.push('Hit **🚀 Start setup** to pick your crew role and set your home coords.');
  } else {
    lines.push('Hit **🚀 Start setup** below for a quick 3-step walkthrough (IGN → crew role → home coords).');
    lines.push('Or run `/profile` and `/help` to do it yourself.');
  }

  if (rolesPanelUrl) {
    lines.push(`Crew roles panel: ${rolesPanelUrl}`);
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`onboard:start:${memberId}`)
      .setStyle(ButtonStyle.Success)
      .setLabel('🚀 Start setup'),
  );
  return {
    content: lines.join('\n'),
    components: [row],
    allowedMentions: { users: [memberId] },
  };
}

function getRolesPanelUrl(guildId) {
  const panel = prepare(`SELECT channel_id, message_id FROM panels WHERE type = 'roles'`).get();
  if (!panel) return null;
  return `https://discord.com/channels/${guildId}/${panel.channel_id}/${panel.message_id}`;
}

function buildLeadershipMentions(guild) {
  if (!guild?.roles?.cache) return { mentionString: '', memberIds: [] };

  const leadershipRoles = LEADERSHIP_ROLE_NAMES
    .map(name => guild.roles.cache.find(r => r.name === name))
    .filter(Boolean);

  const mentionedIds = new Set();
  const mentions = [];

  for (const role of leadershipRoles) {
    for (const member of role.members.values()) {
      if (!mentionedIds.has(member.id)) {
        mentionedIds.add(member.id);
        mentions.push(`<@${member.id}>`);
      }
    }
  }

  return { mentionString: mentions.join(' '), memberIds: Array.from(mentionedIds) };
}

async function sendLeadershipIntro(channel, member, autoIgn) {
  try {
    const { mentionString, memberIds } = buildLeadershipMentions(member.guild);
    const lines = [];

    if (mentionString) {
      lines.push(mentionString);
    }

    lines.push(`New member: **${member.displayName}**`);

    if (autoIgn) {
      lines.push(`IGN: **${autoIgn}** (auto-linked)`);
    } else {
      lines.push(`IGN: *not yet linked*`);
    }

    await channel.send({
      content: lines.join('\n'),
      allowedMentions: { users: memberIds },
    });

    logger.info(`guildMemberAdd: sent leadership intro for ${member.user.tag}`);
  } catch (err) {
    logger.warn(`guildMemberAdd: failed to send leadership intro: ${err.message}`);
  }
}

export async function handleGuildMemberAdd(member) {
  if (member.user?.bot) return;

  // Auto-match display name against map if no existing links
  let autoIgn = null;
  let autoRoles = null;
  const players = getTravianPlayersFromMap();
  if (players.length > 0 && getAllLinksForUser(member.id).length === 0) {
    const match = matchMemberToPlayer(member, players);
    if (match.status === 'matched') {
      const ign = match.player.player;
      const link = transaction(() => {
        prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(member.id);
        upsertAccountFromMap(ign);
        prepare(`INSERT OR IGNORE INTO user_ign_links (discord_id, ign, is_primary, source) VALUES (?, ?, 1, 'sync')`).run(member.id, ign);
      });
      link();
      autoIgn = ign;
      autoRoles = await assignRolesFromIgn({ member, ign });
      logger.info(`guildMemberAdd: auto-linked ${member.user.tag} → ${ign}`);
    }
  }

  // Create private onboarding channel if a category is configured
  const privateChannel = await createMemberOnboardingChannel(member);

  // Rename immediately to the IGN if we already know it
  if (privateChannel && autoIgn) {
    try {
      await privateChannel.setName(safeChannelName(autoIgn));
      await privateChannel.setTopic(`Onboarding | Discord: ${member.displayName} | IGN: ${autoIgn}`);
    } catch (err) {
      logger.warn(`guildMemberAdd: could not update onboarding channel: ${err.message}`);
    }
  }

  // Send leadership intro message before the onboarding wizard
  if (privateChannel) {
    await sendLeadershipIntro(privateChannel, member, autoIgn);
  }

  const payload = buildWelcomePayload({
    memberId: member.id,
    rolesPanelUrl: getRolesPanelUrl(member.guild.id),
    autoIgn,
    autoRoles,
  });

  if (privateChannel) {
    try {
      await privateChannel.send(payload);
    } catch (err) {
      logger.error(`guildMemberAdd: failed to send welcome to private channel: ${err.message}`);
    }
  }

  // Also post a brief ping in the public welcome channel if configured
  const channelId = getConfig('welcome_channel_id');
  if (channelId) {
    let publicChannel;
    try {
      publicChannel = await member.guild.channels.fetch(channelId);
    } catch (err) {
      logger.error(`guildMemberAdd: cannot fetch welcome channel ${channelId}: ${err.message}`);
    }
    if (publicChannel?.isTextBased?.()) {
      const publicMsg = privateChannel
        ? { content: `👋 Welcome <@${member.id}>!`, allowedMentions: { users: [member.id] } }
        : payload;
      try {
        await publicChannel.send(publicMsg);
      } catch (err) {
        logger.error(`guildMemberAdd: failed to send welcome to ${channelId}: ${err.message}`);
      }
    }
  } else if (!privateChannel) {
    logger.warn('guildMemberAdd: neither welcome_channel_id nor onboarding_category_id configured — skipping greeting');
  }
}

export async function handleOnboardSaveCoordsModal(interaction) {
  const raw = interaction.fields.getTextInputValue('coords').trim();
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const result = await applyCoordsAndDeriveTribe({
    discordId: interaction.user.id,
    coordsString: raw,
    member,
  });
  if (!result.ok) {
    const msg = result.reason === 'invalid_coords'
      ? `❌ Invalid coords: \`${raw}\`. Try \`-12|34\`.`
      : result.reason === 'no_village'
        ? `❌ No village at \`${raw}\`. Map may be out of date — ask an admin to run \`/admin fetch-map\`.`
        : result.reason === 'npc_village'
          ? `❌ That's a Nature/Natars village. Enter your own capital's coords.`
          : result.reason === 'wrong_owner'
            ? `❌ \`${raw}\` belongs to **${result.villageOwner}**, not your linked IGN **${result.primaryIgn}**. If this is a dual sitter setup, ask an admin.`
            : result.reason === 'no_primary'
              ? `❌ You don't have a linked IGN yet. Go back to Step 1.`
              : '❌ Could not set coords.';
    return interaction.reply({ content: msg, ephemeral: true });
  }
  let roleNote = result.roleAssigned
    ? ` Tribe role **${result.tribeName}** assigned.`
    : ` Tribe is **${result.tribeName}** — matching role not found on this server.`;
  if (result.allianceAssigned) roleNote += ` **${result.allianceRoleName}** role assigned.`;
  return interaction.reply({ content: `✅ Coords saved.${roleNote} Click **Continue ➡** to finish.`, ephemeral: true });
}
