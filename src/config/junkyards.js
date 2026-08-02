const { YARDS } = require('./yards');

const jalopyJungleLocationMapping = Object.fromEntries(
  YARDS.filter((yard) => yard.junkyardKey === 'jalopyJungle').map((yard) => [
    String(yard.id),
    yard.databaseName,
  ])
);
const trustyYard = YARDS.find(
  (yard) => yard.junkyardKey === 'trustyJunkyard'
);

const junkyards = {
  jalopyJungle: {
    inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
    hasMultipleLocations: true,
    locationMapping: jalopyJungleLocationMapping,
    selectors: {
      yardSelect: '#yard-id',
      makeSelect: '#car-make',
      modelSelect: '#car-model',
      searchForm: '#searchinventory',
      resultsTable: '.table-responsive table',
    },
  },
  trustyJunkyard: {
    inventoryUrl: 'https://inventory.trustypickapart.com/',
    yardId: String(trustyYard.id),
    hasMultipleLocations: false,
    locationMapping: null,
    selectors: {
      yardSelect: null,
      makeSelect: '#car-make',
      modelSelect: '#car-model',
      searchForm: '#searchinventory',
      resultsTable: '.table-responsive table',
    },
  },
};

module.exports = junkyards;
