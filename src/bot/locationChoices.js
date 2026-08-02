const { YARDS } = require('../config/yards');

function freezeChoice(name, value) {
  return Object.freeze({ name, value });
}

const YARD_LOCATION_CHOICES = Object.freeze(
  [...YARDS]
    .sort((left, right) => left.commandOrder - right.commandOrder)
    .map((yard) => freezeChoice(yard.displayName, yard.slug))
);

const ALL_LOCATION_CHOICE = freezeChoice('All', 'all');
const TREASURE_VALLEY_CHOICE = freezeChoice(
  'Treasure Valley Yards',
  'treasurevalleyyards'
);
const SEARCH_LOCATION_CHOICES = Object.freeze([
  ...YARD_LOCATION_CHOICES,
  TREASURE_VALLEY_CHOICE,
  ALL_LOCATION_CHOICE,
]);

module.exports = {
  ALL_LOCATION_CHOICE,
  SEARCH_LOCATION_CHOICES,
  TREASURE_VALLEY_CHOICE,
  YARD_LOCATION_CHOICES,
};
