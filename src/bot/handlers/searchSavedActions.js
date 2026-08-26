const { summarizeError } = require('../../utils/errorSummary');
const { convertYardIdToLocation } = require('../utils/locationUtils');
const {
  canonicalizeYardIdForSavedSearch,
  matchesSavedSearchCriteria,
} = require('../utils/savedSearchCriteria');

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

    await interaction.reply({
      content: exists
        ? 'This search is already saved. Use `/savedsearch` to manage it.'
        : 'Search saved. Use `/savedsearch` to run or manage it.',
      ephemeral: true,
    });
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
      'Error deleting saved search:',
      summarizeError(error)
    );
    await interaction.reply({
      content: 'Error deleting saved search.',
      ephemeral: true,
    });
  }
}

module.exports = {
  handleDeleteAction,
  handleSaveAction,
};
