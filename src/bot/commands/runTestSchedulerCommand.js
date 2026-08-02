const { ensureElevatedCommandAccess } = require('../utils/commandPermissions');
const { summarizeError } = require('../../utils/errorSummary');

async function handleRunTestSchedulerCommand(interaction) {
  if (!(await ensureElevatedCommandAccess(interaction, 'runtestscheduler'))) {
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    const { runMissedMorningJobs } = require('../../notifications/scheduler');
    await runMissedMorningJobs();
    await interaction.editReply('Missed morning jobs completed successfully.');
  } catch (error) {
    console.error('Morning recovery command failed:', summarizeError(error));
    await interaction.editReply('An error occurred while running the missed morning jobs.');
  }
}

module.exports = { handleRunTestSchedulerCommand };
