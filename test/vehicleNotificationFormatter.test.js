const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSavedSearchTitle,
  buildVehicleEmbeds,
} = require('../src/notifications/vehicleNotificationFormatter');

test('saved-search notification title preserves every criterion', () => {
  assert.equal(
    buildSavedSearchTitle({
      make: 'TOYOTA',
      model: 'CAMRY',
      year_range: '2000-2005',
      yard_name: 'BOISE',
      status: 'ACTIVE',
    }),
    'Daily Search Results for TOYOTA CAMRY (2000-2005) at BOISE with ACTIVE status'
  );
});

test('vehicle embeds format dates and include notes only when present', () => {
  const embeds = buildVehicleEmbeds(
    [
      {
        yard_name: 'BOISE',
        row_number: 7,
        vehicle_make: 'TOYOTA',
        vehicle_model: 'CAMRY',
        vehicle_year: 2005,
        first_seen: '2026-08-01T12:00:00.000Z',
        last_updated: '2026-08-02T12:00:00.000Z',
        notes: 'Needs tires',
      },
      {
        yard_name: 'CALDWELL',
        row_number: 8,
        vehicle_make: 'HONDA',
        vehicle_model: 'ACCORD',
        vehicle_year: 2006,
        first_seen: '2026-08-01T12:00:00.000Z',
        last_updated: '2026-08-02T12:00:00.000Z',
        notes: '',
      },
    ],
    'Inventory update'
  );
  const embed = embeds[0].toJSON();

  assert.equal(embed.title, 'Inventory update');
  assert.equal(embed.description, 'Results found: 2');
  assert.match(embed.fields[0].value, /First Seen: August 1, 2026/);
  assert.match(embed.fields[0].value, /Notes: Needs tires/);
  assert.equal(embed.fields[1].value.includes('Notes:'), false);
});

test('vehicle formatting returns no embeds for an empty result set', () => {
  assert.deepEqual(buildVehicleEmbeds([], 'No results'), []);
});
