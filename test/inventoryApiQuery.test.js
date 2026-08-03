const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVehicleQuery,
  parseList,
  parsePositiveInt,
} = require('../src/api/inventoryApiQuery');

test('vehicle query normalizes filters and caps the requested limit', () => {
  const searchParams = new URLSearchParams({
    yard: 'boise, caldwell',
    make: ' toyota ',
    model: 'camry',
    status: 'active',
    year: '2003',
    limit: '50000',
  });
  const query = buildVehicleQuery(searchParams);

  assert.match(query.sql, /UPPER\(yard_name\) IN \(\?,\?\)/);
  assert.match(query.sql, /UPPER\(vehicle_make\) = \?/);
  assert.match(query.sql, /UPPER\(vehicle_model\) = \?/);
  assert.match(query.sql, /vehicle_status IN \('ACTIVE', 'NEW'\)/);
  assert.match(query.sql, /vehicle_year = \?/);
  assert.deepEqual(query.params, [
    'BOISE',
    'CALDWELL',
    'TOYOTA',
    'CAMRY',
    2003,
    10000,
  ]);
  assert.equal(query.limit, 10000);
});

test('vehicle query accepts valid year ranges and inactive status', () => {
  const query = buildVehicleQuery(
    new URLSearchParams({
      status: 'inactive',
      yearStart: '1999',
      yearEnd: '2005',
      limit: '25',
    })
  );

  assert.match(query.sql, /vehicle_status = 'INACTIVE'/);
  assert.match(query.sql, /vehicle_year BETWEEN \? AND \?/);
  assert.deepEqual(query.params, [1999, 2005, 25]);
  assert.equal(query.limit, 25);
});

test('vehicle query ignores invalid filters and uses safe defaults', () => {
  const query = buildVehicleQuery(
    new URLSearchParams({
      status: 'unknown',
      year: '20x6',
      yearStart: '2020',
      yearEnd: '2010',
      limit: '-1',
    })
  );

  assert.doesNotMatch(query.sql, /\bWHERE\b/);
  assert.deepEqual(query.params, [10000]);
  assert.equal(query.limit, 10000);
  assert.deepEqual(parseList(' one, ,two '), ['one', 'two']);
  assert.equal(parsePositiveInt('0', 7), 7);
});
