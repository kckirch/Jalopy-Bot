const {
  queryVehicles,
  getModelSuggestionsForNoResults,
} = require('../../database/vehicleQueryManager');
const {
  addSavedSearch,
  checkExistingSearch,
  deleteSavedSearch,
  getSavedSearches,
} = require('../../database/savedSearchManager');
const {
  handlePagingAction,
  handleRelocateAction,
} = require('./searchNavigationActions');
const {
  handleDeleteAction,
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
      await handleSaveAction(interaction, session, dependencies);
      return true;
    case 'unsave':
      await handleDeleteAction(interaction, session, dependencies);
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
