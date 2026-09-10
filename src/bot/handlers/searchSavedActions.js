const { summarizeError } = require('../../utils/errorSummary');
const { convertYardIdToLocation } = require('../utils/locationUtils');
const {
  canonicalizeYardIdForSavedSearch,
} = require('../../database/savedSearchCriteria');
const { describeAlertDelivery } = require('../utils/savedSearchSession');
const { handleSavedSearchCommand } = require('../commands/savedSearchCommand');
const { startSavedSearchSession } = require('./savedSearchSessionHandler');

async function handleSaveAction(interaction, session, dependencies) {
  const { criteria, searchState } = session;

  try {
    await interaction.deferReply({ ephemeral: true });
    const cleanedYardId = canonicalizeYardIdForSavedSearch(
      searchState.yardId
    );
    const cleanedYardName = convertYardIdToLocation(cleanedYardId)
      .replace(/\s{2,}/g, ' ')
      .trim();
    const exists = await dependencies.checkExistingSearch(
      interaction.user.id,
      cleanedYardId,
      criteria.make,
      criteria.model,
      criteria.yearRange,
      criteria.status
    );

    if (!exists) {
      await dependencies.addSavedSearch(
        interaction.user.id,
        interaction.user.tag,
        cleanedYardId,
        cleanedYardName,
        criteria.make,
        criteria.model,
        criteria.yearRange,
        criteria.status,
        ''
      );
    }

    await interaction.editReply({
      content: exists
        ? 'This alert is already saved. Its settings have not changed. Use Manage Alerts or `/savedsearch` to check whether it is paused.'
        : `Alert saved: ${criteria.make} ${criteria.model}, years ${criteria.yearRange}, at ${cleanedYardName}.\n${describeAlertDelivery(criteria.status)}\nUse Manage Alerts or \`/savedsearch\` to pause, remove, or test DMs.`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(
      'Error checking for existing search:',
      summarizeError(error)
    );
    await interaction.editReply({
      content: 'Unable to confirm this save. Check `/savedsearch` before trying again.',
    });
  }
}

async function handleManageAction(interaction, dependencies) {
  await handleSavedSearchCommand(interaction, {
    getSavedSearches: dependencies.getSavedSearches,
    startSavedSearchSession: (reply, searches) => startSavedSearchSession(reply, searches, dependencies),
  });
}

module.exports = {
  handleManageAction,
  handleSaveAction,
};
