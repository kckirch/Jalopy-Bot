// src/config/junkyards.js

const junkyards = {
  jalopyJungle: {
    inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
    hasMultipleLocations: true,
    locationMapping: {
      '1020': 'BOISE',
      '1021': 'CALDWELL',
      '1022': 'NAMPA',
      '1119': 'GARDENCITY',
      '1099': 'TWINFALLS',
    },
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
    yardId: '999999', // Trusty is a single-location yard
    hasMultipleLocations: false,
    locationMapping: null,
    selectors: {
      yardSelect: null, // No yard selection for single-location yard
      makeSelect: '#car-make',
      modelSelect: '#car-model',
      searchForm: '#searchinventory',
      resultsTable: '.table-responsive table',
    },
  },
};

module.exports = junkyards;
