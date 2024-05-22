async function handleRunTestSchedulerCommand(interaction) {
    console.log('Test scheduler command received.');
    await interaction.deferReply();
  
    try {
      const { performScrape, processSearches } = require('../../notifications/testScheduler');
      await performScrape();
      await processSearches();
      await interaction.editReply('Test scheduler functions have been executed successfully.');
    } catch (error) {
      console.error('Error running test scheduler:', error);
      await interaction.editReply('An error occurred while running the test scheduler.');
    }
  }
  
  module.exports = { handleRunTestSchedulerCommand };
  