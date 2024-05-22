const { processDailySavedSearches } = require('../../notifications/dailyTasks');

async function handleDailySavedSearchCommand(interaction) {
  console.log('Daily saved search command received.');
  try {
    await processDailySavedSearches();
    await interaction.reply('Daily saved searches processed successfully.');
  } catch (error) {
    console.error('Error processing daily saved searches:', error);
    await interaction.reply('An error occurred while processing daily saved searches.');
  }
}

module.exports = { handleDailySavedSearchCommand };
