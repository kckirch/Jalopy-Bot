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
  },
  trustyJunkyard: {
    inventoryUrl: 'https://inventory.trustypickapart.com/',
    yardId: String(trustyYard.id),
    hasMultipleLocations: false,
    locationMapping: null,
  },
};

module.exports = junkyards;
