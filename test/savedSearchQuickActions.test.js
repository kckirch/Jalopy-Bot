const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRunNowEmbed,
  buildSavedSearchActionMessage,
  createQuickActionPayload,
  formatSavedSearchPreview,
  normalizeLocationName,
} = require('../src/bot/utils/savedSearchQuickActions');

function makeVehicle(index) {
  return {
    vehicle_year: 2000 + index,
    vehicle_make: 'TOYOTA',
    vehicle_model: 'CAMRY',
    yard_name: 'BOISE',
    row_number: index,
  };
}

test('quick-action payloads normalize their saved-search identity', () => {
  const payload = createQuickActionPayload({
    userId: 'user-1',
    location: 'boise',
    yardId: 1020,
    make: 'TOYOTA',
    model: 'CAMRY',
    yearRange: '2005',
    status: 'ACTIVE',
    savedSearchId: 42,
    savedIndex: -1,
  });

  assert.deepEqual(payload, {
    uid: 'user-1',
    lc: 'boise',
    yd: '1020',
    mk: 'TOYOTA',
    md: 'CAMRY',
    yr: '2005',
    st: 'ACTIVE',
    sid: 42,
    idx: 0,
  });
  assert.equal(normalizeLocationName('', 1020), 'BOISE');
});

test('saved-search action messages include position and all quick actions', () => {
  const message = buildSavedSearchActionMessage({
    userId: 'user-1',
    location: 'boise',
    yardId: 1020,
    make: 'TOYOTA',
    model: 'CAMRY',
    yearRange: '2005',
    status: 'ACTIVE',
    savedSearchId: 42,
    savedIndex: 1,
    savedSearches: [{ id: 1 }, { id: 42 }],
    title: 'Saved Search',
    message: 'Ready.',
  });

  const savedSearchField = message.embeds[0].data.fields.find(
    (field) => field.name === 'Saved Searches'
  );
  assert.equal(savedSearchField.value, '2 (showing 2 of 2)');
  assert.equal(message.components[0].components.length, 5);
  assert.equal(message.ephemeral, true);
});

test('run-now embeds bound their preview and describe the remaining matches', () => {
  const vehicles = Array.from({ length: 6 }, (_value, index) =>
    makeVehicle(index + 1)
  );
  const embed = buildRunNowEmbed(
    {
      lc: 'boise',
      mk: 'TOYOTA',
      md: 'CAMRY',
      yr: 'ANY',
      st: 'ACTIVE',
    },
    vehicles
  );

  assert.match(embed.data.description, /6/);
  assert.equal(embed.data.footer.text, 'Showing 5 of 6 matches');
  assert.equal(embed.data.fields.at(-1).value.split('\n').length, 5);
});

test('saved-search DM previews cap detail rows and report the remainder', () => {
  const searches = Array.from({ length: 16 }, (_value, index) => ({
    yard_name: 'BOISE',
    make: 'TOYOTA',
    model: `MODEL-${index}`,
    year_range: 'ANY',
    status: 'ACTIVE',
  }));

  const lines = formatSavedSearchPreview(searches).split('\n');
  assert.equal(lines.length, 16);
  assert.equal(lines.at(-1), '- ...and 1 more');
});
