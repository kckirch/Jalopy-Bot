const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalizeYardIdForSavedSearch,
  matchesSavedSearchCriteria,
  normalizeSavedSearchValue,
} = require('../src/database/savedSearchCriteria');

test('saved-search yard IDs have one stable canonical representation', () => {
  assert.equal(
    canonicalizeYardIdForSavedSearch('ALL'),
    '1020,1021,1022,1099,1119,999999'
  );
  assert.equal(
    canonicalizeYardIdForSavedSearch([1021, '1020', 1021]),
    '1020,1021'
  );
  assert.equal(
    canonicalizeYardIdForSavedSearch(' 1021, 1020, 1021 '),
    '1020,1021'
  );
  assert.equal(canonicalizeYardIdForSavedSearch(' custom yard '), 'customyard');
});

test('saved-search criteria match yard sets and normalized values', () => {
  const savedSearch = {
    yard_id: '1021, 1020',
    make: ' Toyota ',
    model: 'camry',
    year_range: '2000-2005',
    status: 'active',
  };

  assert.equal(
    matchesSavedSearchCriteria(savedSearch, {
      yardId: [1020, 1021],
      make: 'TOYOTA',
      model: ' CAMRY ',
      yearRange: '2000-2005',
      status: 'ACTIVE',
    }),
    true
  );
  assert.equal(
    matchesSavedSearchCriteria(savedSearch, {
      yardId: [1020, 1021],
      make: 'HONDA',
      model: 'CAMRY',
      yearRange: '2000-2005',
      status: 'ACTIVE',
    }),
    false
  );
});

test('saved-search values are trimmed and case normalized', () => {
  assert.equal(normalizeSavedSearchValue(' active '), 'ACTIVE');
});
