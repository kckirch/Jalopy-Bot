const { summarizeError } = require('../../utils/errorSummary');
const { convertLocationToYardId } = require('../utils/locationUtils');

function loadDefaultDependencies() {
  const {
    deleteSavedSearch,
    getSavedSearches,
    setSavedSearchFrequency,
  } = require('../../database/savedSearchManager');
  const {
    getModelSuggestionsForNoResults,
    queryVehicles,
  } = require('../../database/vehicleQueryManager');
  const {
    startSavedSearchSession,
  } = require('../handlers/savedSearchSessionHandler');
  return {
    getSavedSearches,
    startSavedSearchSession(interaction, savedSearches) {
      return startSavedSearchSession(interaction, savedSearches, {
        deleteSavedSearch,
        getModelSuggestionsForNoResults,
        queryVehicles,
        setSavedSearchFrequency,
      });
    },
  };
}

async function handleSavedSearchCommand(
  interaction,
  dependencies = loadDefaultDependencies()
) {
  const {
    getSavedSearches: loadSavedSearches,
    startSavedSearchSession: startSession,
    convertLocationToYardId: resolveYardId = convertLocationToYardId,
  } = dependencies;
  const location = interaction.options.getString('location');
  const yardId = location ? resolveYardId(location) : null;

  try {
    await interaction.deferReply({ ephemeral: true });
    const savedSearches = await loadSavedSearches(interaction.user.id, yardId);
    if (savedSearches.length === 0) {
      await interaction.editReply({
        content: 'You have no saved searches matching the criteria.',
      });
      return;
    }

    await startSession(interaction, savedSearches);
  } catch (error) {
    console.error('Error retrieving saved searches:', summarizeError(error));
    await interaction.editReply({ content: 'Failed to retrieve saved searches.' });
  }
}

module.exports = { handleSavedSearchCommand };
