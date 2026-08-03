const { getSavedSearches } = require('../../database/savedSearchManager');
const { summarizeError } = require('../../utils/errorSummary');
const {
  startSavedSearchSession,
} = require('../handlers/savedSearchSessionHandler');
const { convertLocationToYardId } = require('../utils/locationUtils');

async function handleSavedSearchCommand(interaction) {
  const location = interaction.options.getString('location');
  const yardId = location ? convertLocationToYardId(location) : null;

  try {
    await interaction.deferReply({ ephemeral: true });
    const savedSearches = await getSavedSearches(interaction.user.id, yardId);
    if (savedSearches.length === 0) {
      await interaction.editReply({
        content: 'You have no saved searches matching the criteria.',
      });
      return;
    }

    await startSavedSearchSession(interaction, savedSearches);
  } catch (error) {
    console.error('Error retrieving saved searches:', summarizeError(error));
    await interaction.editReply({ content: 'Failed to retrieve saved searches.' });
  }
}

module.exports = { handleSavedSearchCommand };
