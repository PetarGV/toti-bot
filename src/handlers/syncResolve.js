import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function buildSyncResolveButtons({ adminId, conflicts, ambiguous }) {
  if (!conflicts && !ambiguous) return null;
  const row = new ActionRowBuilder();
  if (conflicts) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`sync:resolve-conflicts:${adminId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`🔧 Resolve ${conflicts} conflict${conflicts === 1 ? '' : 's'}`),
    );
  }
  if (ambiguous) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`sync:resolve-ambig:${adminId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`🔧 Resolve ${ambiguous} ambiguous`),
    );
  }
  return row;
}
