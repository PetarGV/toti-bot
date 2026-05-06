import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prepare } from '../db/client.js';
import { formatCoords } from '../utils/coords.js';
import { discordTimestamp } from '../utils/time.js';

const TYPE_EMOJI = {
  'push:lumber': '🪵',
  'push:clay':   '🧱',
  'push:iron':   '🔩',
  'push:crop':   '🌾',
  'push:all':    '📦',
  defense:       '🛡️',
  offense:       '⚔️',
  reinforce:     '🤝',
  urgent:        '🚨',
  scout:         '👀',
};

function typeEmoji(type) {
  return TYPE_EMOJI[type] ?? '📢';
}

async function renderCalls(interaction, offset, isUpdate = false) {
  const countRow = prepare("SELECT COUNT(*) as c FROM calls WHERE status = 'open'").get();
  const total    = countRow.c;
  const rows     = prepare("SELECT * FROM calls WHERE status = 'open' ORDER BY created_at DESC LIMIT 10 OFFSET ?").all(offset);

  const guildId  = interaction.guildId;
  const pageNum  = Math.floor(offset / 10) + 1;
  const pageMax  = Math.max(1, Math.ceil(total / 10));

  const lines = rows.length
    ? rows.map(c => {
        const emoji = typeEmoji(c.type);
        const dl    = c.deadline ? discordTimestamp(c.deadline, 'R') : '*no deadline*';
        const jump  = c.message_id && c.channel_id
          ? ` — [Jump](https://discord.com/channels/${guildId}/${c.channel_id}/${c.message_id})`
          : '';
        return `${emoji} **${c.type}** ${formatCoords(c.x, c.y)} — ${dl}${jump}`;
      })
    : ['*No active calls*'];

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📋 Active Calls (page ${pageNum} / ${pageMax})`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${total} open call${total !== 1 ? 's' : ''}` })
    .setTimestamp();

  const prevDisabled = offset === 0;
  const nextDisabled = offset + 10 >= total;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`calls:page:${Math.max(0, offset - 10)}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(`calls:page:${offset + 10}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Next')
      .setEmoji('➡️')
      .setDisabled(nextDisabled),
  );

  const payload = { embeds: [embed], components: [row] };

  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function handleCallsCommand(interaction) {
  await renderCalls(interaction, 0, false);
}

export async function handleCallsButton(interaction) {
  await renderCalls(interaction, 0, false);
}

export async function handleCallsPage(interaction) {
  const offset = parseInt(interaction.customId.split(':')[2], 10) || 0;
  await renderCalls(interaction, offset, true);
}