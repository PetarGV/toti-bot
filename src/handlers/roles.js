import { PermissionFlagsBits } from 'discord.js';
import {
  ROLE_BUTTON_PREFIX,
  ROLE_SELECT_CUSTOM_ID,
  buildRoleResetPlan,
  buildRoleUpdatePlan,
  getRoleValueFromButtonId,
} from '../utils/roleSelection.js';

function normalizeRoleName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function findRoleByName(guild, roleName) {
  const wanted = normalizeRoleName(roleName);
  return guild.roles.cache.find((role) => normalizeRoleName(role.name) === wanted) ?? null;
}

function resolveRoles(guild, roleNames) {
  return roleNames
    .map((roleName) => findRoleByName(guild, roleName))
    .filter(Boolean);
}

function formatRoleList(roleNames) {
  return roleNames.map((roleName) => `\`${roleName}\``).join(', ');
}

async function getInteractionMember(interaction) {
  if (interaction.member?.roles?.add && interaction.member?.roles?.remove) {
    return interaction.member;
  }
  return interaction.guild.members.fetch(interaction.user.id);
}

async function getBotMember(guild) {
  return guild.members.me ?? guild.members.fetchMe();
}

function getUnmanageableRoles(botMember, roles) {
  return roles.filter((role) =>
    role.managed || botMember.roles.highest.comparePositionTo(role) <= 0
  );
}

async function applyRolePlan(interaction, makePlan, reason) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Role selection only works inside a Discord server.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const member = await getInteractionMember(interaction);
  const guildRoleNames = interaction.guild.roles.cache.map((role) => role.name);
  const memberRoleNames = member.roles.cache.map((role) => role.name);
  let plan;

  try {
    plan = makePlan(memberRoleNames, guildRoleNames);
  } catch {
    return interaction.editReply({ content: 'Unknown role selection. Please try again.' });
  }
  if (plan.missingRoleNames.length > 0) {
    return interaction.editReply({
      content: `I could not find these Discord roles: ${formatRoleList(plan.missingRoleNames)}. Create them with those exact names, then try again.`,
    });
  }

  const botMember = await getBotMember(interaction.guild);
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply({
      content: 'I need the Manage Roles permission before I can assign crew roles.',
    });
  }

  const rolesToAdd = resolveRoles(interaction.guild, plan.addRoleNames);
  const rolesToRemove = resolveRoles(interaction.guild, plan.removeRoleNames);
  const unmanageable = getUnmanageableRoles(botMember, [...rolesToAdd, ...rolesToRemove]);

  if (unmanageable.length > 0) {
    return interaction.editReply({
      content: `I can see these roles, but cannot manage them: ${formatRoleList(unmanageable.map((role) => role.name))}. Move my bot role above them in Discord role settings.`,
    });
  }

  if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove, reason);
  if (rolesToAdd.length > 0) await member.roles.add(rolesToAdd, reason);

  if (!plan.selection) {
    return interaction.editReply({
      content: rolesToRemove.length > 0
        ? `Done. Removed crew roles: ${formatRoleList(plan.removeRoleNames)}.`
        : 'Done. You had no crew roles to remove.',
    });
  }

  const roleList = formatRoleList(plan.selection.roleNames);
  return interaction.editReply({
    content: `Done. You now have ${roleList}.`,
  });
}

export async function handleRoleSelect(interaction) {
  if (interaction.customId !== ROLE_SELECT_CUSTOM_ID) {
    return interaction.reply({ content: 'Unknown role selector.', ephemeral: true });
  }

  return applyRolePlan(
    interaction,
    (memberRoleNames, guildRoleNames) => buildRoleUpdatePlan(interaction.values?.[0], memberRoleNames, guildRoleNames),
    `Crew role selected by ${interaction.user.tag}`,
  );
}

export async function handleRoleButton(interaction) {
  if (!interaction.customId?.startsWith(`${ROLE_BUTTON_PREFIX}:`)) {
    return interaction.reply({ content: 'Unknown role button.', ephemeral: true });
  }

  const value = getRoleValueFromButtonId(interaction.customId);

  return applyRolePlan(
    interaction,
    (memberRoleNames, guildRoleNames) => value === 'reset'
      ? buildRoleResetPlan(memberRoleNames)
      : buildRoleUpdatePlan(value, memberRoleNames, guildRoleNames),
    `Crew role button used by ${interaction.user.tag}`,
  );
}
