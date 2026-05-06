import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl, rallyUrl } from '../utils/travianUrl.js';
import { discordTimestamp, parseDeadline, formatDeadline } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { getDefRoleMention } from '../utils/role.js';
import { registerRenderer } from './calls.js';
import { notifyAuthorOfPledge, notifyAuthorIfMilestone } from './notify.js';
import { getHomeCoordsString } from './profile.js';

// ── Type config ──────────────────────────────────────────────────────────────
export const COMBAT_CONFIG = {
  defense:   { label: 'Defense Call',   emoji: '🛡️', color: 0xe74c3c, ping: 'def', joinLabel: "I'm sending" },
  offense:   { label: 'Offense Call',   emoji: '⚔️', color: 0x992d22, ping: null,  joinLabel: 'Joining attack' },
  reinforce: { label: 'Reinforce',      emoji: '🤝', color: 0xe67e22, ping: 'def', joinLabel: 'Reinforcing' },
  urgent:    { label: '🚨 URGENT 🚨',   emoji: '🚨', color: 0xff0000, ping: 'all', joinLabel: "I'm sending" },
};

// ── Button entry: call:defense|offense|reinforce|urgent ──────────────────────
export async function handleCombatButton(interaction) {
  const type = interaction.customId.split(':')[1]; // e.g. 'defense'

  if (type === 'urgent') {
    logger.info(
      `Urgent triggered by ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel.name}`
    );
  }

  const modal = new ModalBuilder()
    .setCustomId(`combat:create:${type}`)
    .setTitle(COMBAT_CONFIG[type]?.label ?? type);

  const coordsInput = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('(-12|34)')
    .setMaxLength(20);

  try {
    const home = getHomeCoordsString(interaction.user.id);
    if (home) coordsInput.setValue(home);
  } catch { /* no profile */ }

  const arrivalInput = new TextInputBuilder()
    .setCustomId('arrival')
    .setLabel('Arrival (14:30:45 · in 2h30m · 2026-05-06 14:30:45)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('in 2h')
    .setMaxLength(30);

  const attackerInput = new TextInputBuilder()
    .setCustomId('attacker')
    .setLabel('Attacker / target info (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const troopsInput = new TextInputBuilder()
    .setCustomId('troops')
    .setLabel('Troops needed/sending (free text)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(arrivalInput),
    new ActionRowBuilder().addComponents(attackerInput),
    new ActionRowBuilder().addComponents(troopsInput),
    new ActionRowBuilder().addComponents(notesInput),
  );

  await interaction.showModal(modal);
}

// ── Core: insert call + post embed ───────────────────────────────────────────
async function createCombatCall(interaction, type, { x, y, arrival, attacker, troops, notes }) {
  const config = COMBAT_CONFIG[type];
  const payload = JSON.stringify({ attacker: attacker || null, troops: troops || null, notes: notes || null });

  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(type, interaction.user.id, x, y, arrival, interaction.channel.id, payload);

  const callId = result.lastInsertRowid;
  inc('callsCreated');

  // Determine ping content
  let pingContent = '';
  if (config.ping === 'def') {
    const mention = await getDefRoleMention(interaction.guild);
    if (mention) pingContent = mention;
  } else if (config.ping === 'all') {
    pingContent = '@everyone';
  }

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const embed = buildCombatEmbed(call, []);
  const components = buildCombatComponents(call);

  const msg = await interaction.reply({
    content: pingContent,
    embeds: [embed],
    components,
    fetchReply: true,
    allowedMentions: { parse: ['everyone', 'roles'] },
  });

  prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);
}

// ── Modal submit: combat:create:<type> ───────────────────────────────────────
export async function handleCombatCreateModal(interaction) {
  const type = interaction.customId.split(':')[2];
  if (!COMBAT_CONFIG[type]) {
    return interaction.reply({ content: `❌ Unknown combat type: ${type}`, ephemeral: true });
  }

  const coordsStr = interaction.fields.getTextInputValue('coords');
  const arrivalStr = interaction.fields.getTextInputValue('arrival');
  const attacker   = interaction.fields.getTextInputValue('attacker') || null;
  const troops     = interaction.fields.getTextInputValue('troops') || null;
  const notes      = interaction.fields.getTextInputValue('notes') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: `❌ Invalid coordinates: \`${coordsStr}\`.`, ephemeral: true });
  }

  const arrival = parseDeadline(arrivalStr);
  if (!arrival) {
    return interaction.reply({ content: `❌ Invalid arrival time: \`${arrivalStr}\`. Try \`14:30\` or \`in 1h30m\`.`, ephemeral: true });
  }

  await createCombatCall(interaction, type, { x: coords.x, y: coords.y, arrival, attacker, troops, notes });
}

// ── Slash command handlers ───────────────────────────────────────────────────
export async function handleDefenseCommand(interaction) {
  const coordsStr  = interaction.options.getString('coords');
  const arrivalStr = interaction.options.getString('arrival');
  const attacker   = interaction.options.getString('attacker') || null;
  const troops     = interaction.options.getString('troops') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) return interaction.reply({ content: '❌ Invalid coordinates.', ephemeral: true });

  const arrival = parseDeadline(arrivalStr);
  if (!arrival) return interaction.reply({ content: '❌ Invalid arrival time.', ephemeral: true });

  await createCombatCall(interaction, 'defense', { x: coords.x, y: coords.y, arrival, attacker, troops, notes: null });
}

export async function handleOffenseCommand(interaction) {
  const coordsStr  = interaction.options.getString('coords');
  const arrivalStr = interaction.options.getString('arrival');
  const notes      = interaction.options.getString('notes') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) return interaction.reply({ content: '❌ Invalid coordinates.', ephemeral: true });

  const arrival = parseDeadline(arrivalStr);
  if (!arrival) return interaction.reply({ content: '❌ Invalid arrival time.', ephemeral: true });

  await createCombatCall(interaction, 'offense', { x: coords.x, y: coords.y, arrival, attacker: null, troops: null, notes });
}

export async function handleReinforceCommand(interaction) {
  const coordsStr  = interaction.options.getString('coords');
  const arrivalStr = interaction.options.getString('arrival');
  const notes      = interaction.options.getString('notes') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) return interaction.reply({ content: '❌ Invalid coordinates.', ephemeral: true });

  const arrival = parseDeadline(arrivalStr);
  if (!arrival) return interaction.reply({ content: '❌ Invalid arrival time.', ephemeral: true });

  await createCombatCall(interaction, 'reinforce', { x: coords.x, y: coords.y, arrival, attacker: null, troops: null, notes });
}

// ── Response button handlers ─────────────────────────────────────────────────

// combat:join:<callId> — first-time pledge opens modal directly;
// repeat pledge shows an ephemeral Edit/Add choice
export async function handleCombatJoinButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }

  const existing = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  if (existing) {
    const choiceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`combat:pledge_edit:${callId}`).setStyle(ButtonStyle.Primary).setLabel('Edit pledge').setEmoji('✏️'),
      new ButtonBuilder().setCustomId(`combat:pledge_add:${callId}`).setStyle(ButtonStyle.Success).setLabel('Add to pledge').setEmoji('➕'),
    );
    return interaction.reply({
      content: `You already pledged: **${existing.amount ?? 'On it'}**\nEdit replaces it; Add appends more troops.`,
      components: [choiceRow],
      ephemeral: true,
    });
  }

  await showJoinModal(interaction, call, callId, /* prefill */ '');
}

// Helper: open the troops modal. submitId selects the modal handler;
// prefill seeds the input value (used by Edit).
async function showJoinModal(interaction, call, callId, prefill, submitId = `combat:join_submit:${callId}`, title) {
  const config = COMBAT_CONFIG[call.type] ?? COMBAT_CONFIG.defense;

  const modal = new ModalBuilder()
    .setCustomId(submitId)
    .setTitle(title ?? config.joinLabel);

  const troopsInput = new TextInputBuilder()
    .setCustomId('troops')
    .setLabel("Troops you're sending (free text)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('5k inf, 200 cav')
    .setMaxLength(200);

  if (prefill) troopsInput.setValue(prefill);

  modal.addComponents(new ActionRowBuilder().addComponents(troopsInput));
  await interaction.showModal(modal);
}

// combat:pledge_edit:<callId> — opens modal pre-filled with existing pledge; submit overwrites
export async function handleCombatPledgeEditButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }
  const existing = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);
  await showJoinModal(interaction, call, callId, existing?.amount ?? '', `combat:join_submit:${callId}`, 'Edit pledge');
}

// combat:pledge_add:<callId> — opens empty modal; submit appends to existing pledge
export async function handleCombatPledgeAddButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }
  await showJoinModal(interaction, call, callId, '', `combat:pledge_add_submit:${callId}`, 'Add to pledge');
}

// combat:withdraw:<callId>
export async function handleCombatWithdrawButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);
  if (!existing) {
    return interaction.reply({ content: 'You have no commitment on this call.', ephemeral: true });
  }
  prepare('DELETE FROM pledges WHERE call_id = ? AND user_id = ?').run(callId, interaction.user.id);

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: '✅ Withdrawn.', ephemeral: true });
}

// combat:close:<callId>
export async function handleCombatCloseButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return interaction.reply({ content: 'Call not found.', ephemeral: true });

  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (call.author_id !== interaction.user.id && !isAdmin) {
    return interaction.reply({ content: '❌ Only the call author or an admin can close this call.', ephemeral: true });
  }

  prepare("UPDATE calls SET status = 'closed' WHERE id = ?").run(callId);

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: '🔒 Call closed.', ephemeral: true });
}

// combat:update:<callId> — opens modal for author
export async function handleCombatUpdateButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return interaction.reply({ content: 'Call not found.', ephemeral: true });
  if (call.author_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Only the call author can update this call.', ephemeral: true });
  }

  const payload = JSON.parse(call.payload || '{}');

  const modal = new ModalBuilder()
    .setCustomId(`combat:update_submit:${callId}`)
    .setTitle('Update Call');

  const coordsInput = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(formatCoords(call.x, call.y))
    .setMaxLength(20);

  const arrivalInput = new TextInputBuilder()
    .setCustomId('arrival')
    .setLabel('Arrival (14:30:45 · in 2h30m · 2026-05-06 14:30:45)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(call.deadline ? formatDeadline(call.deadline) : '')
    .setMaxLength(30);

  const troopsInput = new TextInputBuilder()
    .setCustomId('troops')
    .setLabel('Troops needed/sending')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  if (payload.troops) troopsInput.setValue(payload.troops);
  if (payload.notes)  notesInput.setValue(payload.notes);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(arrivalInput),
    new ActionRowBuilder().addComponents(troopsInput),
    new ActionRowBuilder().addComponents(notesInput),
  );

  await interaction.showModal(modal);
}

// ── Modal: combat:join_submit:<callId> ───────────────────────────────────────
export async function handleCombatJoinModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }

  const troopsText = interaction.fields.getTextInputValue('troops').trim() || 'On it';

  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  if (existing) {
    prepare('UPDATE pledges SET amount = ? WHERE call_id = ? AND user_id = ?')
      .run(troopsText, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, troopsText);
  }
  inc('pledgesSubmitted');

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: `✅ Commitment recorded: ${troopsText}`, ephemeral: true });

  notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, troopsText).catch(err => logger.warn('notify pledge:', err.message));
  notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
}

// ── Modal: combat:pledge_add_submit:<callId> — append to existing pledge ─────
export async function handleCombatPledgeAddModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }

  const addText = interaction.fields.getTextInputValue('troops').trim();
  if (!addText) {
    return interaction.reply({ content: '❌ Nothing to add — type some troops.', ephemeral: true });
  }

  const existing = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  if (existing) {
    const combined = existing.amount ? `${existing.amount}, +${addText}` : addText;
    prepare('UPDATE pledges SET amount = ? WHERE call_id = ? AND user_id = ?')
      .run(combined, callId, interaction.user.id);
    inc('pledgesSubmitted');

    const { refreshCall } = await import('./calls.js');
    await refreshCall(interaction.client, callId);
    await interaction.reply({ content: `✅ Added: **+${addText}**\nTotal: ${combined}`, ephemeral: true });

    notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, `+${addText}`).catch(err => logger.warn('notify pledge:', err.message));
    notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
  } else {
    // No prior pledge — fall back to insert
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, addText);
    inc('pledgesSubmitted');

    const { refreshCall } = await import('./calls.js');
    await refreshCall(interaction.client, callId);
    await interaction.reply({ content: `✅ Commitment recorded: ${addText}`, ephemeral: true });

    notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, addText).catch(err => logger.warn('notify pledge:', err.message));
    notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
  }
}

// ── Modal: combat:update_submit:<callId> ─────────────────────────────────────
export async function handleCombatUpdateModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return interaction.reply({ content: 'Call not found.', ephemeral: true });
  if (call.author_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Only the call author can update this call.', ephemeral: true });
  }

  const coordsStr  = interaction.fields.getTextInputValue('coords');
  const arrivalStr = interaction.fields.getTextInputValue('arrival');
  const troops     = interaction.fields.getTextInputValue('troops') || null;
  const notes      = interaction.fields.getTextInputValue('notes') || null;

  const coords = parseCoords(coordsStr);
  if (!coords) {
    return interaction.reply({ content: `❌ Invalid coordinates: \`${coordsStr}\`.`, ephemeral: true });
  }

  const arrival = parseDeadline(arrivalStr);
  if (!arrival) {
    return interaction.reply({ content: `❌ Invalid arrival time: \`${arrivalStr}\`.`, ephemeral: true });
  }

  const payload = JSON.parse(call.payload || '{}');
  payload.troops = troops;
  payload.notes  = notes;

  prepare('UPDATE calls SET x = ?, y = ?, deadline = ?, payload = ? WHERE id = ?')
    .run(coords.x, coords.y, arrival, JSON.stringify(payload), callId);

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: '✅ Call updated.', ephemeral: true });
}

// ── Embed builder ────────────────────────────────────────────────────────────
export function buildCombatEmbed(call, pledges) {
  const config = COMBAT_CONFIG[call.type] ?? { label: call.type, emoji: '📢', color: 0x95a5a6, joinLabel: 'Join' };
  const payload = JSON.parse(call.payload || '{}');

  let statusPrefix = '';
  let color = config.color;
  if (call.status === 'filled')  { statusPrefix = '✅ Filled — ';  color = 0x2ecc71; }
  if (call.status === 'expired') { statusPrefix = '⏰ Expired — '; color = 0x95a5a6; }
  if (call.status === 'closed')  { statusPrefix = '🔒 Closed — ';  color = 0x95a5a6; }

  // x_world enrichment
  let coordsExtra = '';
  try {
    const xw = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(call.x, call.y);
    if (xw?.player) {
      coordsExtra = ` — ${xw.player}${xw.alliance ? ` [${xw.alliance}]` : ''}`;
    }
  } catch { /* x_world may not exist */ }

  const title = `${statusPrefix}${config.emoji} ${config.label}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: 'Author',   value: `<@${call.author_id}>`, inline: true },
      { name: 'Coords',   value: `[${formatCoords(call.x, call.y)}](${mapUrl(call.x, call.y)})${coordsExtra}`, inline: true },
      { name: 'Arrival',  value: call.deadline ? `${discordTimestamp(call.deadline, 'D')} ${discordTimestamp(call.deadline, 'T')} (${discordTimestamp(call.deadline, 'R')})` : '*Unknown*', inline: true },
    );

  if (payload.attacker) embed.addFields({ name: 'Attacker / target', value: payload.attacker, inline: false });
  if (payload.troops)   embed.addFields({ name: 'Troops needed',      value: payload.troops,   inline: false });
  if (payload.notes)    embed.addFields({ name: 'Notes',              value: payload.notes,    inline: false });

  // Responders
  const MAX_SHOWN = 15;
  const sorted = [...pledges].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  const shown = sorted.slice(0, MAX_SHOWN);
  const responderLines = shown.map(p => `<@${p.user_id}> — ${p.amount ?? 'On it'}`);
  if (sorted.length > MAX_SHOWN) responderLines.push(`_...and ${sorted.length - MAX_SHOWN} more_`);

  embed.addFields({
    name: `Responders (${pledges.length})`,
    value: responderLines.length ? responderLines.join('\n') : '*No responders yet*',
    inline: false,
  });

  embed.setFooter({ text: `Call ID: ${call.id}` }).setTimestamp();

  return embed;
}

// ── Components builder ───────────────────────────────────────────────────────
export function buildCombatComponents(call) {
  const config = COMBAT_CONFIG[call.type] ?? { joinLabel: 'Join' };
  const id = call.id;

  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Map').setEmoji('🗺️').setURL(mapUrl(call.x, call.y)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Send Troops').setEmoji('🚀').setURL(rallyUrl(call.x, call.y)),
  );

  if (call.status !== 'open') return [linkRow];

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`combat:join:${id}`).setStyle(ButtonStyle.Success).setLabel(config.joinLabel).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`combat:withdraw:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Withdraw').setEmoji('❌'),
    new ButtonBuilder().setCustomId(`combat:update:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Update').setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`combat:close:${id}`).setStyle(ButtonStyle.Danger).setLabel('Close').setEmoji('🔒'),
  );

  return [actionRow, linkRow];
}

// ── Register renderers for all four combat types ─────────────────────────────
for (const type of ['defense', 'offense', 'reinforce', 'urgent']) {
  registerRenderer(type, {
    buildEmbed:      (call, pledges) => buildCombatEmbed(call, pledges),
    buildComponents: (call)          => buildCombatComponents(call),
  });
}

