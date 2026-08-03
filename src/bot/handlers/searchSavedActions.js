const { summarizeError } = require('../../utils/errorSummary');
const { convertYardIdToLocation } = require('../utils/locationUtils');
const {
  canonicalizeYardIdForSavedSearch,
  matchesSavedSearchCriteria,
} = require('../utils/savedSearchCriteria');
const {
  buildSavedSearchActionMessage,
  formatSavedSearchPreview,
} = require('../utils/savedSearchQuickActions');

async function handleSaveAction(interaction, session, dependencies) {
  const { criteria, searchState } = session;

  try {
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

    let savedSearchId;
    if (!exists) {
      savedSearchId = await dependencies.addSavedSearch(
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

    const savedSearches = await dependencies.getSavedSearches(
      interaction.user.id
    );
    const responsePayload = buildSavedSearchActionMessage({
      userId: interaction.user.id,
      location: searchState.location,
      yardId: cleanedYardId,
      make: criteria.make,
      model: criteria.model,
      yearRange: criteria.yearRange,
      status: criteria.status,
      savedSearchId,
      savedSearches,
      title: exists ? 'Search Already Saved' : 'Search Saved',
      message: exists
        ? 'This search is already in your saved list. You can run it now, jump through saved searches, or delete it.'
        : 'Saved this search. Use the buttons below to keep working without retyping.',
    });
    await interaction.reply(responsePayload);
  } catch (error) {
    console.error(
      'Error checking for existing search:',
      summarizeError(error)
    );
    await interaction.reply({
      content: 'Error checking for existing searches.',
      ephemeral: true,
    });
  }
}

async function handleDeleteAction(interaction, session, dependencies) {
  const { criteria, searchState } = session;

  try {
    const cleanedYardId = canonicalizeYardIdForSavedSearch(
      searchState.yardId
    );
    const savedSearches = await dependencies.getSavedSearches(
      interaction.user.id
    );
    const matchingSearches = savedSearches.filter((savedSearch) =>
      matchesSavedSearchCriteria(savedSearch, {
        yardId: cleanedYardId,
        make: criteria.make,
        model: criteria.model,
        yearRange: criteria.yearRange,
        status: criteria.status,
      })
    );

    if (matchingSearches.length === 0) {
      await interaction.reply({
        content: 'This search is not currently saved.',
        ephemeral: true,
      });
      return;
    }

    for (const savedSearch of matchingSearches) {
      await dependencies.deleteSavedSearch(savedSearch.id);
    }

    const pluralSuffix = matchingSearches.length === 1 ? '' : 'es';
    await interaction.reply({
      content: `Removed ${matchingSearches.length} matching saved search${pluralSuffix}.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error(
      'Error deleting saved search from quick action:',
      summarizeError(error)
    );
    await interaction.reply({
      content: 'Error deleting saved search.',
      ephemeral: true,
    });
  }
}

async function handleSavedListAction(interaction, dependencies) {
  try {
    const savedSearches = await dependencies.getSavedSearches(
      interaction.user.id
    );
    if (savedSearches.length === 0) {
      await interaction.reply({
        content: 'You currently have no saved searches.',
        ephemeral: true,
      });
      return;
    }

    const previewText = formatSavedSearchPreview(savedSearches);
    try {
      await interaction.user.send({
        content: `Your saved searches (${savedSearches.length}):\n${previewText}\n\nUse /savedsearch to page through and delete specific entries.`,
      });
      await interaction.reply({
        content: `Sent ${savedSearches.length} saved search(es) to your DMs.`,
        ephemeral: true,
      });
    } catch (dmError) {
      console.error(
        'Unable to DM saved searches:',
        summarizeError(dmError)
      );
      await interaction.reply({
        content: 'I could not DM you. Please enable DMs or use /savedsearch.',
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error(
      'Error listing saved searches from quick action:',
      summarizeError(error)
    );
    await interaction.reply({
      content: 'Error retrieving saved searches.',
      ephemeral: true,
    });
  }
}

module.exports = {
  handleDeleteAction,
  handleSaveAction,
  handleSavedListAction,
};
