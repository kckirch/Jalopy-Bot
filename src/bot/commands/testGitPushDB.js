async function handleRunTestGitPushDBCommand(interaction) {
    console.log('Test Git Push DB command received.');
    await interaction.deferReply();
  
    try {
      const { pushToDatabase } = require('../../notifications/pushToScrapedData');
      await pushToDatabase();
      await interaction.editReply('Test Git Push DB function has been executed successfully.');
    } catch (error) {
      console.error('Error running Test Git Push DB:', error);
      await interaction.editReply('An error occurred while running the Test Git Push DB function.');
    }
  }
  
  module.exports = { handleRunTestGitPushDBCommand };
