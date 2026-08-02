const test = require('node:test');
const assert = require('node:assert/strict');
const { YARDS } = require('../src/config/yards');
const junkyards = require('../src/config/junkyards');
const {
  YARD_LOCATION_CHOICES,
} = require('../src/bot/commandDefinitions');

test('yard catalog is immutable and has unique identities', () => {
  assert.equal(Object.isFrozen(YARDS), true);
  assert.equal(YARDS.every((yard) => Object.isFrozen(yard)), true);
  assert.equal(new Set(YARDS.map((yard) => yard.id)).size, YARDS.length);
  assert.equal(new Set(YARDS.map((yard) => yard.slug)).size, YARDS.length);
  assert.equal(
    new Set(YARDS.map((yard) => yard.databaseName)).size,
    YARDS.length
  );
});

test('junkyard scraper configuration is derived from the yard catalog', () => {
  const jalopyYards = YARDS.filter(
    (yard) => yard.junkyardKey === 'jalopyJungle'
  );
  const trustyYard = YARDS.find(
    (yard) => yard.junkyardKey === 'trustyJunkyard'
  );

  assert.deepEqual(
    junkyards.jalopyJungle.locationMapping,
    Object.fromEntries(
      jalopyYards.map((yard) => [String(yard.id), yard.databaseName])
    )
  );
  assert.equal(junkyards.trustyJunkyard.yardId, String(trustyYard.id));
});

test('yard catalog preserves command and Treasure Valley ordering', () => {
  const commandYards = [...YARDS]
    .sort((left, right) => left.commandOrder - right.commandOrder)
    .map((yard) => ({ name: yard.displayName, value: yard.slug }));
  const treasureValleyOrder = YARDS.filter(
    (yard) => yard.treasureValleyOrder !== null
  )
    .sort((left, right) => left.treasureValleyOrder - right.treasureValleyOrder)
    .map((yard) => yard.id);

  assert.deepEqual(YARD_LOCATION_CHOICES, commandYards);
  assert.deepEqual(treasureValleyOrder, [1020, 1119, 1021, 1022, 999999]);
});
