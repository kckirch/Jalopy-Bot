const test = require('node:test');
const assert = require('node:assert/strict');
const { YARDS } = require('../src/config/yards');
const {
  SavedSearchSession,
} = require('../src/bot/utils/savedSearchSession');

function createSavedSearch(overrides = {}) {
  return {
    id: 1,
    yard_id: '1020',
    yard_name: 'BOISE',
    make: 'TOYOTA',
    model: 'CAMRY',
    year_range: '2000-2005',
    status: 'ACTIVE',
    frequency: 'daily',
    create_date: '2026-01-02T00:00:00.000Z',
    update_date: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

function createVehicle(index) {
  return {
    vehicle_year: 2000 + index,
    vehicle_make: 'TOYOTA',
    vehicle_model: 'CAMRY',
    yard_name: 'BOISE',
    row_number: index + 1,
    first_seen: '2026-01-02T00:00:00.000Z',
    last_updated: '2026-01-03T00:00:00.000Z',
  };
}

function getEmbedData(payload) {
  return payload.embeds[0].toJSON();
}

function getButtonLabels(payload) {
  return payload.components[0].components.map(
    (button) => button.data.label
  );
}

test('saved-search session owns a copy of the initial search list', () => {
  const initialSearches = [
    createSavedSearch(),
    createSavedSearch({ id: 2, make: 'HONDA', model: 'ACCORD' }),
  ];
  const session = new SavedSearchSession(initialSearches);
  initialSearches.pop();

  assert.equal(session instanceof SavedSearchSession, true);
  assert.equal(session.getSearch(1).id, 2);
});

test('saved-search navigation resolves and clamps indexes consistently', () => {
  const session = new SavedSearchSession([
    createSavedSearch(),
    createSavedSearch({ id: 2, make: 'HONDA', model: 'ACCORD' }),
  ]);

  assert.equal(session.resolveIndex('-10'), 0);
  assert.equal(session.resolveIndex('99'), 1);
  assert.equal(session.resolveIndex('not-a-number'), 0);

  session.moveSaved(0, 1);
  assert.equal(session.getSearch().id, 2);
  assert.equal(session.resolveIndex(undefined), 1);

  session.moveSaved(1, 20);
  assert.equal(session.getSearch().id, 2);
  session.showSaved(-20);
  assert.equal(session.getSearch().id, 1);
});

test('results paging clamps at both ends and active view follows session mode', () => {
  const session = new SavedSearchSession([createSavedSearch()]);
  const vehicles = Array.from({ length: 21 }, (_, index) =>
    createVehicle(index)
  );

  assert.equal(session.moveResultsPage(1), false);
  assert.match(getEmbedData(session.buildActiveViewPayload()).title, /Saved Search:/);

  session.activateResults(0, vehicles, []);
  assert.equal(session.hasResults(), true);
  assert.equal(
    getEmbedData(session.buildActiveViewPayload()).footer.text,
    'Page 1 of 2'
  );

  assert.equal(session.moveResultsPage(1), true);
  assert.equal(
    getEmbedData(session.buildResultsViewPayload()).footer.text,
    'Page 2 of 2'
  );
  session.moveResultsPage(20);
  assert.equal(
    getEmbedData(session.buildResultsViewPayload()).footer.text,
    'Page 2 of 2'
  );
  session.moveResultsPage(-20);
  assert.equal(
    getEmbedData(session.buildResultsViewPayload()).footer.text,
    'Page 1 of 2'
  );

  session.showSaved(0);
  assert.equal(session.hasResults(), false);
  assert.match(getEmbedData(session.buildActiveViewPayload()).title, /Saved Search:/);
});

test('removing searches preserves unrelated results and clears matching results', () => {
  const firstSearch = createSavedSearch();
  const secondSearch = createSavedSearch({
    id: 2,
    make: 'HONDA',
    model: 'ACCORD',
  });
  const session = new SavedSearchSession([firstSearch, secondSearch]);
  session.activateResults(1, [createVehicle(0)], []);

  assert.equal(session.remove(0), firstSearch);
  assert.equal(session.hasResults(), true);
  assert.equal(session.getSearch().id, 2);
  assert.equal(session.isEmpty(), false);

  assert.equal(session.remove(0), secondSearch);
  assert.equal(session.hasResults(), false);
  assert.equal(session.isEmpty(), true);
});

test('frequency updates drive the next action and saved-search view', () => {
  const session = new SavedSearchSession([createSavedSearch()]);

  assert.equal(session.getNextFrequency(0), 'paused');
  session.updateFrequency(0, 'paused', '2026-02-03T00:00:00.000Z');

  assert.equal(session.getSearch().frequency, 'paused');
  assert.equal(
    session.getSearch().update_date,
    '2026-02-03T00:00:00.000Z'
  );
  assert.equal(session.getNextFrequency(0), 'daily');
  assert.match(
    getEmbedData(session.buildSavedViewPayload()).description,
    /Alerts: Paused/
  );
  assert.ok(getButtonLabels(session.buildSavedViewPayload()).includes('Resume Alerts'));
});

test('result views infer canonical aggregate, single, and fallback locations', () => {
  const allYards = YARDS.map(({ id }) => id).reverse().join(',');
  const treasureValleyYards = YARDS.filter(
    ({ treasureValleyOrder }) => treasureValleyOrder !== null
  )
    .map(({ id }) => id)
    .reverse()
    .join(',');
  const cases = [
    [allYards, 'all'],
    [treasureValleyYards, 'treasurevalleyyards'],
    ['1020', 'boise'],
    ['123456', 'unknownyard'],
  ];

  for (const [yardId, expectedLocation] of cases) {
    const session = new SavedSearchSession([
      createSavedSearch({ yard_id: yardId }),
    ]);
    session.activateResults(0, [], ['CAMRY']);
    assert.match(
      getEmbedData(session.buildResultsViewPayload()).title,
      new RegExp(`results for ${expectedLocation} `, 'i')
    );
  }
});
