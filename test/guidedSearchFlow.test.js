const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { MessageFlags } = require('discord.js');

const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-guided-search-'));
const previousDatabasePath = process.env.VEHICLE_DB_PATH;
process.env.VEHICLE_DB_PATH = path.join(fixtureDirectory, 'inventory.sqlite');
const { db, setupDatabase } = require('../src/database/database');
const queries = require('../src/database/vehicleQueryManager');
const searches = require('../src/database/savedSearchManager');
const { handleSearchCommand } = require('../src/bot/commands/searchCommand');
const { SavedSearchSession } = require('../src/bot/utils/savedSearchSession');
const { makeInteraction } = require('../test-support/searchCommandHarness');
const { withInteractionResponses } = require('../test-support/interactionResponses');
const { createSearchState } = require('../src/bot/handlers/searchState');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const run = promisify(db.run).bind(db);

function action(customId, overrides = {}) {
  const replies = [], updates = [];
  return withInteractionResponses({ customId: `search:${customId}`, user: { id: 'guided-user', tag: 'Fixture' },
    replies, updates, async reply(payload) { replies.push(payload); }, async update(payload) { updates.push(payload); }, ...overrides });
}

async function click(search, customId, overrides) {
  const interaction = action(customId, overrides);
  await search.message.collector.emitCollect(interaction);
  return interaction;
}

async function start(options) {
  const interaction = makeInteraction({ location: 'boise', ...options }, 'guided-user');
  await handleSearchCommand(interaction);
  return interaction;
}

function controls(payload) {
  return payload.components.flatMap((row) => row.components.map((control) => control.toJSON()));
}

test.before(setupDatabase);
test.beforeEach(async () => {
  await run('DELETE FROM vehicles');
  await run('DELETE FROM saved_searches');
  for (const [make, model, year, status, yard = 1020] of [
    ['BMW', '328I', 2008, 'ACTIVE'], ['BMW', '330CI', 2008, 'NEW'], ['BMW', 'M3', 2008, 'ACTIVE'],
    ['BMW', 'X5', 2008, 'ACTIVE'], ['BMW', '328I', 2005, 'ACTIVE'], ['BMW', '328I', 2012, 'ACTIVE'],
    ['BMW', '328I', 2013, 'INACTIVE'], ['BMW', '335I', 2014, 'ACTIVE'], ['BMW', 'M3', 2015, 'ACTIVE'],
    ['BMW', '428I', 2015, 'ACTIVE'], ['BMW', '330I', 2019, 'ACTIVE', 1021], ['BMW', '330I', 2020, 'ACTIVE'],
    ['TOYOTA', 'COROLLA', 2010, 'ACTIVE'], ['TOYOTA', 'COROLLA', 2008, 'INACTIVE', 1021],
    ['LEXUS', 'RX330', 2008, 'ACTIVE'], ['VW', 'GOLF', 2008, 'ACTIVE'], ['VW', 'GTI', 2008, 'NEW'],
  ]) {
    await run('INSERT INTO vehicles (yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, vehicle_status, first_seen, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [yard, 'Fixture yard', make, model, year, status, '2026-09-09', '2026-09-10']);
  }
});
test.after(async () => {
  await promisify(db.close).call(db);
  fs.rmSync(fixtureDirectory, { recursive: true });
  if (previousDatabasePath === undefined) delete process.env.VEHICLE_DB_PATH;
  else process.env.VEHICLE_DB_PATH = previousDatabasePath;
});

test('make and multi-edit model typos recover privately while preserving every other filter', async () => {
  const search = await start({ make: 'TOYTA', model: 'CORROLA', year: '2008', status: 'ACTIVE' });
  assert.deepEqual(search.deferOptions, { flags: MessageFlags.Ephemeral });
  assert(controls(search.replies[0]).some((control) => control.options?.some((option) => option.value === 'TOYOTA')));
  const fixedMake = await click(search, 'make', { values: ['TOYOTA'] });
  const suggestions = controls(fixedMake.updates[0]).find((control) => control.custom_id === 'search:model');
  assert(suggestions.options.some((option) => option.value === 'COROLLA'));
  const fixedModel = await click(search, 'model', { values: ['COROLLA'] });
  assert.equal(fixedModel.updates[0].embeds[0].data.footer.text, '0 matches');
  assert.match(fixedModel.updates[0].embeds[0].data.description, /recognized/);
  await click(search, 'save');
  const [saved] = await searches.getSavedSearches('guided-user');
  assert.deepEqual([saved.make, saved.model, saved.year_range, saved.yard_id, saved.status], ['TOYOTA', 'COROLLA', '2008', '1020', 'ACTIVE']);
});

test('family expansion is offered with results and saved as an explicit make-scoped group', async () => {
  const legacyId = await searches.addSavedSearch('guided-user', 'Fixture', '1020', 'BOISE', 'BMW', '328I', '2008', 'ACTIVE', 'keep');
  const [legacyBefore] = await searches.getSavedSearches('guided-user');
  const search = await start({ make: 'BMW', model: '328I', year: '2006-2011' });
  assert.equal(search.replies[0].embeds[0].data.fields.length, 1);
  const groupMenu = controls(search.replies[0]).find((control) => control.custom_id === 'search:group');
  assert.equal(groupMenu.options[0].value, 'FAMILY: 3 SERIES');
  const expanded = await click(search, 'group', { values: ['FAMILY: 3 SERIES'] });
  assert.equal(expanded.updates[0].embeds[0].data.fields.length, 3);
  assert.match(expanded.updates[0].embeds[0].data.description, /Years: 2006-2011.*Location: boise.*ACTIVE/);
  assert.match(expanded.updates[0].embeds[0].data.description, /not just spelling variants/);
  await click(search, 'save');
  const rows = await searches.getSavedSearches('guided-user');
  assert.deepEqual(rows.find(({ id }) => id === legacyId), legacyBefore);
  const saved = rows.find(({ id }) => id !== legacyId);
  assert.equal(saved.model, 'FAMILY: 3 SERIES');
  assert.equal((await queries.queryVehicles(saved.yard_id, saved.make, saved.model, saved.year_range, saved.status)).length, 3);
  await click(search, 'save');
  assert.equal((await searches.getSavedSearches('guided-user')).length, 2);
});

test('generation selection changes the displayed year range and survives save and reopen', async () => {
  const search = await start({ make: 'BMW', model: 'F30', year: '2099' });
  assert.match(search.replies[0].embeds[0].data.description, /Choose the generation preset/);
  const value = 'GENERATION: F3X (APPROX)';
  const chosen = await click(search, 'group', { values: [value] });
  const embed = chosen.updates[0].embeds[0].data;
  assert.match(embed.description, /Years: 2012-2019.*Location: boise.*ACTIVE/);
  assert.match(embed.description, /chassis is not verified.*overlap/);
  assert.deepEqual(embed.fields.map(({ name }) => name).sort(), ['BMW 328I (2012)', 'BMW 335I (2014)']);
  assert(!controls(chosen.updates[0]).some((control) => control.custom_id === 'search:any-year'));
  await click(search, 'save');
  const [saved] = await searches.getSavedSearches('guided-user');
  assert.deepEqual([saved.model, saved.year_range, saved.yard_id, saved.status], [value, '2012-2019', '1020', 'ACTIVE']);
  const replay = await queries.queryVehicles(saved.yard_id, saved.make, saved.model, saved.year_range, saved.status);
  assert.equal(replay.length, 2);
  const session = new SavedSearchSession([saved]);
  const reopened = session.buildSavedViewPayload();
  assert.match(reopened.embeds[0].data.description, /Approximate generation.*not verified/);
  session.activateResults(0, replay, []);
  assert.match(session.buildResultsViewPayload().embeds[0].data.description, /Approximate generation.*not verified/);
  session.activateResults(0, [], []);
  const empty = session.buildResultsViewPayload().embeds[0].data.description;
  assert.match(empty, /recognized/);
  assert(!empty.includes('Edit Search'));
  const invalidClear = await click(search, 'any-year');
  assert.match(invalidClear.replies[0].content, /generation has a year window/);
});

test('generation windows, selected years, yards, statuses and make boundaries are all enforced', async () => {
  const query = (model, year = 'ANY', status = 'ACTIVE', yard = 'ALL') => queries.queryVehicles(yard, 'BMW', model, year, status);
  const e9x = await query('GENERATION: E9X (APPROX)');
  assert(e9x.some((row) => row.vehicle_model === 'M3'));
  assert(e9x.every((row) => row.vehicle_year >= 2006 && row.vehicle_year <= 2013 && row.vehicle_model !== 'X5'));
  const f3x = await query('GENERATION: F3X (APPROX)');
  assert.deepEqual(f3x.map((row) => row.vehicle_year).sort(), [2012, 2014, 2019]);
  assert.deepEqual(await query('GENERATION: F3X (APPROX)', '2008'), []);
  assert.deepEqual((await query('GENERATION: F3X (APPROX)', 'ANY', 'INACTIVE')).map((row) => row.vehicle_year), [2013]);
  assert.deepEqual((await query('FAMILY: 3 SERIES', '2008', 'NEW', 1020)).map((row) => row.vehicle_model), ['330CI']);
  assert.deepEqual(await query('FAMILY: 3 SERIES', '2008', 'NEW', 1021), []);
  for (const [make, model] of [['ANY', 'FAMILY: 3 SERIES'], ['LEXUS', 'FAMILY: 3 SERIES'], ['BMW', 'GENERATION: UNKNOWN'], ['BMW', "FAMILY: ' OR 1=1 --"]]) {
    assert.deepEqual(await queries.queryVehicles('ALL', make, model, 'ANY', 'ACTIVE'), []);
  }
  assert.equal((await queries.queryVehicles('ALL', 'VW', 'FAMILY: GOLF / GTI FAMILY', '2008', 'ACTIVE')).length, 2);
});

test('relaxing location or year changes only the selected filter and does not edit a saved alert', async () => {
  const search = await start({ make: 'BMW', model: '328I', year: '2099', status: 'NEW' });
  await click(search, 'save');
  const before = await searches.getSavedSearches('guided-user');
  const widerYear = await click(search, 'any-year');
  assert.match(widerYear.updates[0].embeds[0].data.description, /Years: ANY.*Location: boise.*Status: NEW/);
  const widerLocation = await click(search, 'all-locations');
  assert.equal(widerLocation.updates[0].embeds[0].data.title, 'BMW 328I');
  assert.match(widerLocation.updates[0].embeds[0].data.description, /Years: ANY.*Location: all.*Status: NEW/);
  assert.deepEqual(await searches.getSavedSearches('guided-user'), before);
});

test('stale make, group and location choices cannot change the criteria that get saved', async () => {
  const search = await start({ make: 'TOYOTA', model: 'COROLLA', year: '2010' });
  for (const [name, value] of [['make', 'BMW'], ['group', 'FAMILY: 3 SERIES'], ['relocate', 'not-a-yard']]) {
    const rejected = await click(search, name, { values: [value] });
    assert.equal(rejected.updates.length, 0);
    assert.equal(rejected.replies.length, 1);
  }
  await click(search, 'save');
  const [saved] = await searches.getSavedSearches('guided-user');
  assert.deepEqual([saved.make, saved.model, saved.year_range, saved.yard_id], ['TOYOTA', 'COROLLA', '2010', '1020']);
});

test('a failed group response cannot silently broaden the alert saved afterward', async () => {
  const search = await start({ make: 'BMW', model: '328I', year: '2008' });
  const output = joinedConsoleText(await captureConsole(() => click(search, 'group', {
    values: ['FAMILY: 3 SERIES'], async update() { throw new Error('private fixture content'); },
  })));
  assert.doesNotMatch(output, /private fixture content/);
  await click(search, 'save');
  const [saved] = await searches.getSavedSearches('guided-user');
  assert.equal(saved.model, '328I');
});

test('suggestion failures leave zero-result search controls available without exposing error details', async () => {
  let state;
  const output = joinedConsoleText(await captureConsole(async () => {
    state = await createSearchState('boise', { make: 'TOYOTA', model: 'CORROLA', yearRange: '2008', status: 'ACTIVE' }, {
      queryVehicles: async () => [],
      getModelSuggestionsForNoResults: async () => { throw new Error('private database details'); },
    });
  }));
  assert.deepEqual(state.vehicles, []);
  assert.deepEqual(state.suggestedModels, []);
  assert(state.groups.length > 0);
  assert.doesNotMatch(output, /private database details/);
});
