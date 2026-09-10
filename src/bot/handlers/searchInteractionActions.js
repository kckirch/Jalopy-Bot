const {
  queryVehicles,
  getModelSuggestionsForNoResults,
} = require('../../database/vehicleQueryManager');
const {
  addSavedSearch,
  checkExistingSearch,
  deleteSavedSearch,
  getSavedSearches,
  setSavedSearchFrequency,
} = require('../../database/savedSearchManager');
const {
  handlePagingAction,
  handleRelocateAction,
  handleModelSuggestionAction,
  handleRefineAction,
} = require('./searchNavigationActions');
const {
  handleManageAction,
  handleSaveAction,
} = require('./searchSavedActions');
const {
  createSearchState: createSearchStateWithDependencies,
} = require('./searchState');

const DEFAULT_DEPENDENCIES = Object.freeze({
  addSavedSearch,
  checkExistingSearch,
  deleteSavedSearch,
  getModelSuggestionsForNoResults,
  getSavedSearches,
  setSavedSearchFrequency,
  queryVehicles,
});

function createSearchState(
  targetLocation,
  criteria,
  dependencies = DEFAULT_DEPENDENCIES
) {
  return createSearchStateWithDependencies(
    targetLocation,
    criteria,
    dependencies
  );
}

async function handleSearchAction(
  interaction,
  action,
  session,
  dependencies = DEFAULT_DEPENDENCIES
) {
  switch (action) {
    case 'next':
    case 'previous':
      await handlePagingAction(interaction, action, session);
      return true;
    case 'save':
      if (session.searchState.validationError) {
        await interaction.reply({ content: 'Fix the highlighted search field before saving an alert.', ephemeral: true });
        return true;
      }
      await handleSaveAction(interaction, session, dependencies);
      return true;
    case 'manage':
      await handleManageAction(interaction, dependencies);
      return true;
    case 'model':
      await handleModelSuggestionAction(interaction, session, dependencies);
      return true;
    case 'make':
    case 'group':
    case 'any-year':
    case 'all-locations':
    case 'edit-submit':
      await handleRefineAction(interaction, action, session, dependencies);
      return true;
    case 'relocate':
      await handleRelocateAction(
        interaction,
        session,
        dependencies
      );
      return true;
    default:
      return false;
  }
}

module.exports = {
  createSearchState,
  handleSearchAction,
};
