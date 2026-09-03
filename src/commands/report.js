import { handlePushReportCommand } from '../handlers/pushReport.js';
import { handleResourceRosterCommand } from '../handlers/resourceRoster.js';

export async function handleReport(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'pushes') {
    return handlePushReportCommand(interaction);
  }

  if (sub === 'roster') {
    return handleResourceRosterCommand(interaction);
  }

  return interaction.reply({ content: 'Unknown report.', ephemeral: true });
}
