const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeYardId,
} = require('../src/scraping/yardIdNormalization');

test('yard IDs accept only complete positive safe integers', () => {
  assert.equal(normalizeYardId(1020), 1020);
  assert.equal(normalizeYardId(' 001020 '), 1020);

  for (const invalidValue of [
    null,
    '',
    0,
    -1020,
    '1020junk',
    '1020.5',
    '1e3',
    '999999999999999999999999',
  ]) {
    assert.equal(normalizeYardId(invalidValue), null);
  }
});
