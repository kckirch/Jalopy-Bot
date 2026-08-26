const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLocation,
  resolveYard,
} = require('../src/testing/liveScrapeSmokeTest');

test('live smoke CLI accepts one configured yard and rejects extra machinery', () => {
  assert.equal(parseLocation([]), 'boise');
  assert.equal(parseLocation(['--location', 'Nampa']), 'nampa');
  assert.equal(parseLocation(['--help']), null);
  assert.equal(resolveYard('trustypickapart').id, 999999);
  assert.throws(() => resolveYard('all'), /Unknown smoke-test location/);
  assert.throws(() => parseLocation(['--engine', 'selenium']), /Usage:/);
});
