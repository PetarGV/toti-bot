import { CREW_ROLE_NAMES, ROLE_SELECTIONS, ROLE_BUTTON_PREFIX } from '../utils/roleSelection.js';
import { getPrimaryLinkForUser, setUserIgnFromInput } from './userIgnLinks.js';
import { prepare } from '../db/client.js';
import { parseCoords } from '../utils/coords.js';
import { setAccountCoords, setAccountTribe } from './travianAccounts.js';
import { buildTribeRolePlan } from '../utils/tribeRoles.js';
import { getTribe } from '../utils/tribes.js';
import { logger } from '../utils/logger.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

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

async function assignTribeRole({ member, plan }) {
  const guildRoles = member.guild.roles.cache;
  const findByName = (name) => {
    if (typeof guildRoles.find === 'function') return guildRoles.find(r => r.name === name);
    return Array.from(guildRoles.values()).find(r => r.name === name);
  };

  const targetRole = findByName(plan.targetName);
  if (plan.addRoleNames.length > 0 && !targetRole) {
    logger.warn(`tribe role '${plan.targetName}' missing on guild — skipping assignment`);
    return false;
  }

  const toAdd = plan.addRoleNames.map(findByName).filter(Boolean);
  const toRemove = plan.removeRoleNames.map(findByName).filter(Boolean);

  if (toAdd.length) await member.roles.add(toAdd);
  if (toRemove.length) await member.roles.remove(toRemove);
  return true;
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
  setAccountTribe(primary.ign, village.tid);

  const memberRoleNames = Array.from(member.roles.cache.values()).map(r => r.name);
  const plan = buildTribeRolePlan({ tid: village.tid, memberRoleNames });
  let roleAssigned = true;
  if (plan && (plan.addRoleNames.length || plan.removeRoleNames.length)) {
    roleAssigned = await assignTribeRole({ member, plan });
  }

  return { ok: true, tribeName: getTribe(village.tid).name, roleAssigned };
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
  return interaction.reply({ content: `✅ IGN set to **${result.canonical}**. Click **Continue ➡** on the wizard to move to Step 2.`, ephemeral: true });
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
  const roleNote = result.roleAssigned
    ? ` Tribe role **${result.tribeName}** assigned.`
    : ` Tribe is **${result.tribeName}** — but the matching Discord role isn't on this server. Ask an admin to create it.`;
  return interaction.reply({ content: `✅ Coords saved.${roleNote} Click **Continue ➡** to finish.`, ephemeral: true });
}
