const { ensureElevatedCommandAccess } = require('../utils/commandPermissions');

async function handleRunTestGitPushDBCommand(interaction) {
    console.log('Test Git Push DB command received.');
    if (!(await ensureElevatedCommandAccess(interaction, 'testgitpushdb'))) {
      return;
    }
    await interaction.deferReply({ ephemeral: true });
  
    try {
      console.log('Running Test Git Push DB function...');
      const { pushToScrapedData } = require('../../notifications/pushToScrapedData');
      await pushToScrapedData();
      await interaction.editReply('Test Git Push DB function has been executed successfully.');
    } catch (error) {
      console.error('Error running Test Git Push DB:', error);
      await interaction.editReply('An error occurred while running the Test Git Push DB function.');
    }
}

module.exports = { handleRunTestGitPushDBCommand };
