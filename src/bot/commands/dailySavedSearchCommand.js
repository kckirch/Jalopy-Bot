const { processDailySavedSearches } = require('../../notifications/dailyTasks');

async function handleDailySavedSearchCommand(interaction) {
  console.log('Daily saved search command received.');
  try {
    await interaction.deferReply({ ephemeral: true });
    await processDailySavedSearches();
    await interaction.editReply('Daily saved searches processed successfully.');
  } catch (error) {
    console.error('Error processing daily saved searches:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('An error occurred while processing daily saved searches.');
    } else {
      await interaction.reply({ content: 'An error occurred while processing daily saved searches.', ephemeral: true });
    }
  }
}

module.exports = { handleDailySavedSearchCommand };
