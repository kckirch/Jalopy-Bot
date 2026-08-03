const {
  convertLocationToYardId,
} = require('../utils/locationUtils');
const {
  getSearchResultPageCount,
  sortVehiclesForSearchView,
} = require('../utils/vehicleSearchResults');

async function createSearchState(targetLocation, criteria, dependencies) {
  const targetYardId = convertLocationToYardId(targetLocation);
  const targetVehicles = await dependencies.queryVehicles(
    targetYardId,
    criteria.make,
    criteria.model,
    criteria.yearRange,
    criteria.status
  );
  const suggestedModels =
    targetVehicles.length === 0 && criteria.model !== 'ANY'
      ? await dependencies.getModelSuggestionsForNoResults(
          criteria.make,
          criteria.model,
          targetYardId,
          8
        )
      : [];
  const sortedVehicles = sortVehiclesForSearchView(targetVehicles);

  return {
    location: targetLocation,
    yardId: targetYardId,
    vehicles: sortedVehicles,
    suggestedModels,
    currentPage: 0,
    totalPages: getSearchResultPageCount(sortedVehicles),
  };
}

module.exports = { createSearchState };
