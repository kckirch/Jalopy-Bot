const {
  convertLocationToYardId,
} = require('../utils/locationUtils');
const {
  getSearchResultPageCount,
  sortVehiclesForSearchView,
} = require('../utils/vehicleSearchResults');
const { validateSearchCriteria } = require('../utils/searchCriteria');
const { getMakeSuggestions, normalizeModelForLooseComparison: normalize } = require('../../database/vehicleSearchNormalization');
const { getSearchGroup, getSearchGroups } = require('../../database/vehicleSearchGroups');
const { summarizeError } = require('../../utils/errorSummary');

async function createSearchState(targetLocation, criteria, dependencies) {
  const targetYardId = convertLocationToYardId(targetLocation);
  const validationError = validateSearchCriteria(criteria);
  if (validationError) {
    return {
      location: targetLocation, yardId: targetYardId, vehicles: [], currentPage: 0, totalPages: 0,
      suggestedModels: [], groups: [], validationError,
      suggestedMakes: validationError.field === 'make' ? getMakeSuggestions(criteria.make) : [],
    };
  }
  const targetVehicles = await dependencies.queryVehicles(
    targetYardId,
    criteria.make,
    criteria.model,
    criteria.yearRange,
    criteria.status
  );
  const group = getSearchGroup(criteria.make, criteria.model);
  let suggestions = [];
  if (targetVehicles.length === 0 && criteria.model !== 'ANY' && !group) {
    try {
      // A valid spelling can exist at another yard or only in inventory history.
      suggestions = await dependencies.getModelSuggestionsForNoResults(criteria.make, criteria.model, 'ALL', 8);
    } catch (error) {
      // Suggestions are optional; a failed lookup must not break the search/alert controls.
      console.error('Unable to load search suggestions:', summarizeError(error));
    }
  }
  const knownModel = targetVehicles.length > 0 || criteria.model === 'ANY' || Boolean(group) ||
    suggestions.some((model) => normalize(model) === normalize(criteria.model));
  const suggestedModels = knownModel ? [] : suggestions.filter((model) => normalize(model) !== normalize(criteria.model));
  const sortedVehicles = sortVehiclesForSearchView(targetVehicles);

  return {
    location: targetLocation,
    yardId: targetYardId,
    vehicles: sortedVehicles,
    suggestedModels,
    knownModel,
    groups: getSearchGroups(criteria.make, criteria.model),
    currentPage: 0,
    totalPages: getSearchResultPageCount(sortedVehicles),
  };
}

module.exports = { createSearchState };
