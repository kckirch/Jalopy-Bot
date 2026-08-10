const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDailyVehicleEmbeds,
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

test('daily vehicle embeds include deterministic part footers for retry deduplication', () => {
  const vehicles = Array.from({ length: 26 }, (_value, index) => ({
    yard_name: 'BOISE',
    row_number: index,
    vehicle_make: 'TEST',
    vehicle_model: 'MODEL',
    vehicle_year: 2000,
    first_seen: '2026-08-10T12:00:00.000Z',
    last_updated: '2026-08-10T12:00:00.000Z',
  }));
  const embeds = buildDailyVehicleEmbeds(vehicles, '20260810');

  assert.match(
    embeds[0].toJSON().footer.text,
    /^Daily inventory 20260810 • part 1 of 2 • [a-f0-9]{12}$/
  );
  assert.match(
    embeds[1].toJSON().footer.text,
    /^Daily inventory 20260810 • part 2 of 2 • [a-f0-9]{12}$/
  );
});

test('daily vehicle embeds publish a zero-result heartbeat', () => {
  const [embed] = buildDailyVehicleEmbeds([], '20260810');
  const payload = embed.toJSON();

  assert.equal(payload.title, 'Daily Inventory Update');
  assert.match(payload.description, /No new vehicles were added today/);
  assert.equal(payload.footer.text, 'Daily inventory 20260810 • part 1 of 1');
});

test('daily content IDs are stable across query order and change with content', () => {
  const first = {
    id: 2,
    yard_name: 'BOISE',
    row_number: 20,
    vehicle_make: 'HONDA',
    vehicle_model: 'CIVIC',
    vehicle_year: 2005,
    first_seen: '2026-08-10T12:00:00.000Z',
    last_updated: '2026-08-10T12:00:00.000Z',
  };
  const second = { ...first, id: 1, row_number: 10 };
  const orderedFooter = buildDailyVehicleEmbeds(
    [first, second],
    '20260810'
  )[0].toJSON().footer.text;
  const reversedFooter = buildDailyVehicleEmbeds(
    [second, first],
    '20260810'
  )[0].toJSON().footer.text;
  const changedFooter = buildDailyVehicleEmbeds(
    [{ ...first, row_number: 21 }, second],
    '20260810'
  )[0].toJSON().footer.text;

  assert.equal(orderedFooter, reversedFooter);
  assert.notEqual(orderedFooter, changedFooter);
});
