import { EmbedBuilder } from 'discord.js';
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

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand.info)
    .setTitle('⏱️ Your Timer')
    .addFields(
      { name: 'Interval',  value: formatDuration(t.interval_sec),  inline: true },
      { name: 'Label',     value: t.label || '*none*',             inline: true },
      { name: 'Fires',     value: String(t.fires_count),           inline: true },
      { name: 'Next Ping', value: discordTimestamp(t.next_fire_at, 'R'), inline: false },
      { name: 'Channel',   value: `<#${t.channel_id}>`,            inline: true },
    )
    .setFooter({ text: FOOTER });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}