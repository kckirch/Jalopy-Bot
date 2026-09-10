const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SEARCH_RESULTS_PER_PAGE,
  buildSearchResultsEmbed,
  getSearchResultPageCount,
  sortVehiclesForSearchView,
} = require('../src/bot/utils/vehicleSearchResults');

function makeVehicle(index, overrides = {}) {
  return {
    vehicle_year: 2000 + index,
    vehicle_make: 'TOYOTA',
    vehicle_model: `MODEL ${String(index).padStart(2, '0')}`,
    yard_name: 'BOISE',
    row_number: index,
    first_seen: '2026-01-02T12:00:00.000Z',
    last_updated: '2026-01-03T12:00:00.000Z',
    notes: '',
    ...overrides,
  };
}

test('search-result sorting is newest-first without mutating query rows', () => {
  const rows = [
    makeVehicle(1, {
      vehicle_model: 'ZETA',
      first_seen: '2026-01-01T12:00:00.000Z',
    }),
    makeVehicle(2, {
      vehicle_model: 'BETA',
      first_seen: '2026-01-03T12:00:00.000Z',
    }),
    makeVehicle(3, {
      vehicle_model: 'ALPHA',
      first_seen: '2026-01-03T12:00:00.000Z',
    }),
  ];

  const sorted = sortVehiclesForSearchView(rows);
  assert.deepEqual(
    sorted.map((vehicle) => vehicle.vehicle_model),
    ['ALPHA', 'BETA', 'ZETA']
  );
  assert.deepEqual(
    rows.map((vehicle) => vehicle.vehicle_model),
    ['ZETA', 'BETA', 'ALPHA']
  );
});

test('empty search results show at most eight model suggestions', () => {
  const embed = buildSearchResultsEmbed({
    location: 'boise',
    make: 'MAZDA',
    model: 'RX7',
    yearRange: 'ANY',
    status: 'ACTIVE',
    vehicles: [],
    currentPage: 0,
    totalPages: 0,
    suggestedModels: Array.from({ length: 10 }, (_, index) => `RX${index}`),
  });

  assert.match(embed.data.title, /boise MAZDA RX7 \(ANY\) ACTIVE/);
  assert.match(embed.data.description, /RX0, RX1, RX2, RX3, RX4, RX5, RX6, RX7/);
  assert.equal(embed.data.description.includes('RX8'), false);
  assert.equal(embed.data.footer.text, '0 matches');
});

test('search result pages contain twenty vehicles and preserve notes', () => {
  const vehicles = Array.from({ length: 21 }, (_, index) => makeVehicle(index));
  vehicles[20].notes = 'Bring tools';
  const totalPages = getSearchResultPageCount(vehicles);

  assert.equal(SEARCH_RESULTS_PER_PAGE, 20);
  assert.equal(totalPages, 2);

  const firstPage = buildSearchResultsEmbed({
    location: 'boise',
    make: 'ANY',
    model: 'ANY',
    yearRange: 'ANY',
    status: 'ACTIVE',
    vehicles,
    currentPage: 0,
    totalPages,
  });
  const secondPage = buildSearchResultsEmbed({
    location: 'boise',
    make: 'ANY',
    model: 'ANY',
    yearRange: 'ANY',
    status: 'ACTIVE',
    vehicles,
    currentPage: 1,
    totalPages,
  });

  assert.equal(firstPage.data.fields.length, 20);
  assert.equal(firstPage.data.footer.text, 'Page 1 of 2');
  assert.equal(secondPage.data.fields.length, 1);
  assert.match(secondPage.data.fields[0].value, /First Seen: 1\/2/);
  assert.match(secondPage.data.fields[0].value, /Last Updated: 1\/3/);
  assert.match(secondPage.data.fields[0].value, /Notes: Bring tools/);
  assert.equal(secondPage.data.footer.text, 'Page 2 of 2');
});
