const test = require('node:test');
const assert = require('node:assert/strict');

const {
  convertLocationToYardId,
  convertYardIdToLocation,
} = require('../src/bot/utils/locationUtils');

test('convertLocationToYardId returns expected yard IDs for known locations', () => {
  assert.equal(convertLocationToYardId('boise'), 1020);
  assert.equal(convertLocationToYardId('Garden City'), 1119);
  assert.equal(convertLocationToYardId('nampa'), 1022);
  assert.equal(convertLocationToYardId('caldwell'), 1021);
  assert.equal(convertLocationToYardId('twinfalls'), 1099);
  assert.equal(convertLocationToYardId('trustypickapart'), 999999);
});

test('convertLocationToYardId handles aggregate options', () => {
  assert.equal(convertLocationToYardId('all'), 'ALL');
  assert.deepEqual(convertLocationToYardId('treasurevalleyyards'), [1020, 1119, 1021, 1022, 999999]);
});

test('convertLocationToYardId falls back to ALL for unknown location', () => {
  assert.equal(convertLocationToYardId('not-a-real-yard'), 'ALL');
});

test('convertYardIdToLocation handles all supported yard ID shapes', () => {
  assert.equal(convertYardIdToLocation(1020), 'BOISE');
  assert.equal(convertYardIdToLocation('999999'), 'TRUSTYPICKAPART');
  assert.equal(convertYardIdToLocation('1020, 1022'), 'BOISE, NAMPA');
  assert.equal(convertYardIdToLocation([1021, 1099]), 'CALDWELL, TWINFALLS');
});

test('convertYardIdToLocation for ALL includes all known yard names', () => {
  const all = convertYardIdToLocation('ALL');
  assert.match(all, /BOISE/);
  assert.match(all, /CALDWELL/);
  assert.match(all, /GARDENCITY/);
  assert.match(all, /NAMPA/);
  assert.match(all, /TWINFALLS/);
  assert.match(all, /TRUSTYPICKAPART/);
});
