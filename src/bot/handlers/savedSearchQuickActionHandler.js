const { queryVehicles } = require('../../database/vehicleQueryManager');
const {
  deleteSavedSearch,
  getSavedSearches,
} = require('../../database/savedSearchManager');
const { resolveQuickActionPayload } = require('../utils/interactionParameters');
const {
  executeSavedSearchQuickAction,
} = require('./savedSearchQuickActionActions');

const DEFAULT_DEPENDENCIES = Object.freeze({
  deleteSavedSearch,
  getSavedSearches,
  queryVehicles,
});

async function handleSavedSearchQuickActionButton(
  interaction,
  quickHash,
  dependencies = DEFAULT_DEPENDENCIES
) {
  const payload = resolveQuickActionPayload(quickHash);
  if (!payload) {
    await interaction.reply({
      content: 'This action expired. Please save the search again.',
      ephemeral: true,
    });
    return;
  }
  if (payload.uid && payload.uid !== interaction.user.id) {
    await interaction.reply({
      content: 'You do not have permission to use this action.',
      ephemeral: true,
    });
    return;
  }
  await executeSavedSearchQuickAction(interaction, payload, dependencies);
}

module.exports = { handleSavedSearchQuickActionButton };
