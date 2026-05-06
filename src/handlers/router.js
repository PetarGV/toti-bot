import { handleSetup, handleAdmin } from '../commands/admin.js';
import { handleWhoisCommand, handleWhoisButton, handleWhoisModalSubmit } from './whois.js';
import {
  handlePushButton, handlePushCommand, handlePushCreateModal,
  handlePledgeAddButton, handlePledgeWithdrawButton, handlePledgeCloseButton,
  handlePledgeSubmitModal,
} from './resourcePush.js';
import {
  handleCombatButton,
  handleCombatCreateModal,
  handleCombatJoinButton,
  handleCombatWithdrawButton,
  handleCombatCloseButton,
  handleCombatUpdateButton,
  handleCombatJoinModal,
  handleCombatUpdateModal,
  handleCombatPledgeEditButton,
  handleCombatPledgeAddButton,
  handleCombatPledgeAddModal,
  handleDefenseCommand,
  handleOffenseCommand,
  handleReinforceCommand,
} from './combat.js';
import {
  handleScoutButton,
  handleScoutCreateModal,
  handleScoutJoinButton,
  handleScoutReportButton,
  handleScoutCloseButton,
  handleScoutReportModal,
  handleScoutCommand,
} from './scoutCall.js';
import { handleStatusCommand, handleStatusButton } from './status.js';
import { handleCallsCommand, handleCallsButton, handleCallsPage } from './callsList.js';
import {
  handleProfileButton, handleProfileModal, handleProfileCommand, handleNotifyToggle,
  handleEditIgnButton, handleEditIgnModal,
  handleEditCoordsButton, handleEditCoordsModal,
  handleTribeSelect,
} from './profile.js';
import { handleLeaderboardCommand } from './leaderboard.js';
import { handleTimerCommand } from './timer.js';
import { handleHelpCommand, handleHelpSelect } from './help.js';
import { logger } from '../utils/logger.js';

async function notImplemented(interaction) {
  const id = interaction.customId ?? interaction.commandName;
  return interaction.reply({ content: `🚧 \`${id}\` is not yet implemented.`, ephemeral: true });
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied)        return await interaction.followUp({ ...payload, ephemeral: true });
    if (interaction.deferred)       return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (err) {
    logger.warn('safeReply failed:', err.message);
  }
}

// ── Slash command router ─────────────────────────────────────────────────────
export async function routeCommand(interaction) {
  try {
    switch (interaction.commandName) {
      case 'setup':     return await handleSetup(interaction);
      case 'admin':     return await handleAdmin(interaction);
      case 'whois':     return await handleWhoisCommand(interaction);
      case 'push':      return await handlePushCommand(interaction);
      case 'defense':   return await handleDefenseCommand(interaction);
      case 'offense':   return await handleOffenseCommand(interaction);
      case 'reinforce': return await handleReinforceCommand(interaction);
      case 'scout':     return await handleScoutCommand(interaction);
      case 'status':   return await handleStatusCommand(interaction);
      case 'calls':    return await handleCallsCommand(interaction);
      case 'profile':  return await handleProfileCommand(interaction);
      case 'leaderboard': return await handleLeaderboardCommand(interaction);
      case 'timer':       return await handleTimerCommand(interaction);
      case 'help':        return await handleHelpCommand(interaction);
      default:
        return await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (err) {
    logger.error('Command error:', err);
    const reply = { content: '❌ An error occurred. Please try again.', ephemeral: true };
    await safeReply(interaction, reply);
  }
}

// ── Button interaction router ────────────────────────────────────────────────
export async function routeButton(interaction) {
  const id = interaction.customId;
  const [ns, action] = id.split(':');
  try {
    if (id === 'panel:status')        return await handleStatusButton(interaction);
    if (id === 'panel:calls')         return await handleCallsButton(interaction);
    if (id === 'panel:profile')       return await handleProfileButton(interaction);
    if (id === 'profile:edit-ign')    return await handleEditIgnButton(interaction);
    if (id === 'profile:edit-coords') return await handleEditCoordsButton(interaction);
    if (id === 'notify:toggle')       return await handleNotifyToggle(interaction);
    if (id.startsWith('calls:page:')) return await handleCallsPage(interaction);

    // Specific single-id buttons first
    if (id === 'intel:whois') return await handleWhoisButton(interaction);

    if (ns === 'push') {
      return await handlePushButton(interaction);
    }

    if (ns === 'pledge') {
      if (action === 'add')      return await handlePledgeAddButton(interaction);
      if (action === 'withdraw') return await handlePledgeWithdrawButton(interaction);
      if (action === 'close')    return await handlePledgeCloseButton(interaction);
    }

    if (ns === 'call') {
      // Panel buttons: call:defense|offense|reinforce|urgent|scout
      if (['defense', 'offense', 'reinforce', 'urgent'].includes(action)) {
        return await handleCombatButton(interaction);
      }
      if (action === 'scout') return await handleScoutButton(interaction);
    }

    if (ns === 'combat') {
      if (action === 'join')         return await handleCombatJoinButton(interaction);
      if (action === 'withdraw')     return await handleCombatWithdrawButton(interaction);
      if (action === 'close')        return await handleCombatCloseButton(interaction);
      if (action === 'update')       return await handleCombatUpdateButton(interaction);
      if (action === 'pledge_edit')  return await handleCombatPledgeEditButton(interaction);
      if (action === 'pledge_add')   return await handleCombatPledgeAddButton(interaction);
    }

    if (ns === 'scout') {
      if (action === 'join')   return await handleScoutJoinButton(interaction);
      if (action === 'report') return await handleScoutReportButton(interaction);
      if (action === 'close')  return await handleScoutCloseButton(interaction);
    }

    // Remaining unimplemented
    if (id === 'intel:report') return await notImplemented(interaction);

    return await interaction.reply({ content: 'Unknown button.', ephemeral: true });
  } catch (err) {
    logger.error('Button error [%s]:', id, err);
    const reply = { content: '❌ Something went wrong.', ephemeral: true };
    await safeReply(interaction, reply);
  }
}

// ── Select menu router ───────────────────────────────────────────────────────
export async function routeSelect(interaction) {
  const id = interaction.customId;
  try {
    if (id === 'profile:tribe-select')   return await handleTribeSelect(interaction);
    if (id === 'help:category')          return await handleHelpSelect(interaction);
    return await interaction.reply({ content: 'Unknown selection.', ephemeral: true });
  } catch (err) {
    logger.error('Select error [%s]:', id, err);
    await safeReply(interaction, { content: '❌ Something went wrong.', ephemeral: true });
  }
}

// ── Modal submit router ──────────────────────────────────────────────────────
export async function routeModal(interaction) {
  const id = interaction.customId;
  try {
    if (id === 'whois:lookup')                  return await handleWhoisModalSubmit(interaction);
    if (id.startsWith('push:create:'))          return await handlePushCreateModal(interaction);
    if (id.startsWith('pledge:submit:'))        return await handlePledgeSubmitModal(interaction);
    if (id.startsWith('combat:create:'))        return await handleCombatCreateModal(interaction);
    if (id.startsWith('combat:join_submit:'))        return await handleCombatJoinModal(interaction);
    if (id.startsWith('combat:update_submit:'))      return await handleCombatUpdateModal(interaction);
    if (id.startsWith('combat:pledge_add_submit:'))  return await handleCombatPledgeAddModal(interaction);
    if (id === 'scout:create')                  return await handleScoutCreateModal(interaction);
    if (id.startsWith('scout:report_submit:'))  return await handleScoutReportModal(interaction);
    if (id === 'profile:save')                  return await handleProfileModal(interaction);
    if (id === 'profile:save-ign')              return await handleEditIgnModal(interaction);
    if (id === 'profile:save-coords')           return await handleEditCoordsModal(interaction);
    return await notImplemented(interaction);
  } catch (err) {
    logger.error('Modal error [%s]:', id, err);
    const reply = { content: '❌ Something went wrong.', ephemeral: true };
    await safeReply(interaction, reply);
  }
}