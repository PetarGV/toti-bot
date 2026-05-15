import {
  EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseDuration, formatDuration } from '../utils/duration.js';
import { unixNow, discordTimestamp } from '../utils/time.js';
import { COLORS, FOOTER } from '../utils/i18n.js';

export function startOrReplaceTimer({ userId, channelId, intervalSec, label }) {
  const next = unixNow() + intervalSec;
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, 0, ?, 0, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      channel_id    = excluded.channel_id,
      interval_sec  = excluded.interval_sec,
      next_fire_at  = excluded.next_fire_at,
      fires_count   = 0,
      label         = excluded.label,
      paused        = 0,
      remaining_sec = NULL
  `).run(userId, channelId, intervalSec, next, label);
  return { nextFireAt: next };
}

export async function handleTimerCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'set')    return await handleSet(interaction);
  if (sub === 'stop')   return await handleStop(interaction);
  if (sub === 'status') return await handleStatus(interaction);
}

async function handleSet(interaction) {
  const intervalRaw = interaction.options.getString('interval');
  const label       = interaction.options.getString('label') ?? null;
  const interval    = parseDuration(intervalRaw);

  if (!interval) {
    return interaction.reply({
      content: '❌ Invalid interval. Examples: `7m`, `90s`, `1h30m`. Min 60s, max 24h.',
      ephemeral: true,
    });
  }

  const { nextFireAt: next } = startOrReplaceTimer({
    userId:      interaction.user.id,
    channelId:   interaction.channel.id,
    intervalSec: interval,
    label,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand.success)
    .setTitle('⏱️ Timer Started')
    .setDescription(
      `Interval: **${formatDuration(interval)}**${label ? ` · Label: **${label}**` : ''}\n` +
      `Next ping: ${discordTimestamp(next, 'R')}\n\n` +
      `Use \`/timer stop\` to cancel.`
    )
    .setFooter({ text: FOOTER });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleStop(interaction) {
  const existing = prepare('SELECT * FROM timers WHERE user_id = ?').get(interaction.user.id);
  if (!existing) {
    return interaction.reply({ content: 'You have no active timer.', ephemeral: true });
  }
  prepare('DELETE FROM timers WHERE user_id = ?').run(interaction.user.id);
  await interaction.reply({
    content: `⏹️ Timer stopped. Fired ${existing.fires_count} time(s).`,
    ephemeral: true,
  });
}

async function handleStatus(interaction) {
  const t = prepare('SELECT * FROM timers WHERE user_id = ?').get(interaction.user.id);
  if (!t) {
    return interaction.reply({ content: 'You have no active timer. Start one with `/timer set`.', ephemeral: true });
  }

  await interaction.reply({ embeds: [buildStatusEmbed(t)], ephemeral: true });
}

export function buildStatusEmbed(t) {
  const stateValue = t.paused
    ? `⏸️ Paused · ${formatDuration(Math.max(0, t.remaining_sec ?? 0))} left`
    : `▶️ Running`;

  const nextPing = t.paused
    ? '*paused — tap Pause to resume*'
    : discordTimestamp(t.next_fire_at, 'R');

  return new EmbedBuilder()
    .setColor(t.paused ? COLORS.brand.warning : COLORS.brand.info)
    .setTitle('⏱️ Your Timer')
    .addFields(
      { name: 'State',     value: stateValue,                          inline: true },
      { name: 'Interval',  value: formatDuration(t.interval_sec),      inline: true },
      { name: 'Label',     value: t.label || '*none*',                 inline: true },
      { name: 'Fires',     value: String(t.fires_count),               inline: true },
      { name: 'Next Ping', value: nextPing,                            inline: false },
      { name: 'Channel',   value: `<#${t.channel_id}>`,                inline: true },
    )
    .setFooter({ text: FOOTER });
}

const PRESETS = {
  '7m':  7 * 60,
  '10m': 10 * 60,
  '13m': 13 * 60,
};

function startedReply(intervalSec, nextFireAt, replaced) {
  const verb = replaced ? 'replaced' : 'started';
  return {
    content:
      `▶️ Timer ${verb} — every **${formatDuration(intervalSec)}**, next ping ${discordTimestamp(nextFireAt, 'R')}.` +
      (replaced ? ' Fires reset.' : ''),
    ephemeral: true,
  };
}

export async function handleTimerPanelPreset(interaction) {
  const key = interaction.customId.split(':')[2];
  const intervalSec = PRESETS[key];
  if (!intervalSec) {
    return interaction.reply({ content: 'Unknown preset.', ephemeral: true });
  }

  const existing = prepare('SELECT user_id FROM timers WHERE user_id = ?').get(interaction.user.id);
  const { nextFireAt } = startOrReplaceTimer({
    userId:      interaction.user.id,
    channelId:   interaction.channel.id,
    intervalSec,
    label:       null,
  });
  await interaction.reply(startedReply(intervalSec, nextFireAt, !!existing));
}

export async function handleTimerPanelCustom(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('timer:custom_submit')
    .setTitle('Custom Timer');

  const interval = new TextInputBuilder()
    .setCustomId('interval')
    .setLabel('Interval (e.g. 7m, 1h30m, 90s)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('10m')
    .setMaxLength(20);

  const label = new TextInputBuilder()
    .setCustomId('label')
    .setLabel('Label (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(40);

  modal.addComponents(
    new ActionRowBuilder().addComponents(interval),
    new ActionRowBuilder().addComponents(label),
  );

  await interaction.showModal(modal);
}

export async function handleTimerPanelCustomModal(interaction) {
  const intervalRaw = interaction.fields.getTextInputValue('interval');
  const labelRaw    = interaction.fields.getTextInputValue('label');
  const intervalSec = parseDuration(intervalRaw);

  if (!intervalSec) {
    return interaction.reply({
      content: '❌ Invalid interval. Examples: `7m`, `90s`, `1h30m`. Min 60s, max 24h.',
      ephemeral: true,
    });
  }

  const existing = prepare('SELECT user_id FROM timers WHERE user_id = ?').get(interaction.user.id);
  const { nextFireAt } = startOrReplaceTimer({
    userId:      interaction.user.id,
    channelId:   interaction.channel.id,
    intervalSec,
    label:       labelRaw?.trim() || null,
  });
  await interaction.reply(startedReply(intervalSec, nextFireAt, !!existing));
}