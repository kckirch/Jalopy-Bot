const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { setImmediate } = require('node:timers/promises');

// Set isolation before importing any command that opens the shared database.
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-discord-flow-'));
const previousDatabasePath = process.env.VEHICLE_DB_PATH;
process.env.VEHICLE_DB_PATH = path.join(fixtureDirectory, 'inventory.sqlite');
const { db, setupDatabase } = require('../src/database/database');
const queries = require('../src/database/vehicleQueryManager');
const searches = require('../src/database/savedSearchManager');
const { handleSearchCommand } = require('../src/bot/commands/searchCommand');
const { handleSavedSearchCommand } = require('../src/bot/commands/savedSearchCommand');
const { normalizeModelForLooseComparison } = require('../src/database/vehicleSearchNormalization');
const { convertLocationToYardId } = require('../src/bot/utils/locationUtils');
const { makeInteraction: makeSearch } = require('../test-support/searchCommandHarness');
const { makeInteraction: makeManager, createSavedSearchCommand, getButtonByLabel } = require('../test-support/savedSearchCommandHarness');
const { withInteractionResponses } = require('../test-support/interactionResponses');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const run = promisify(db.run).bind(db);

function component(customId, overrides = {}) {
  const replies = [];
  const updates = [];
  return withInteractionResponses({
    customId,
    user: { id: 'flow-user', tag: 'Fixture only' },
    replies,
    updates,
    async reply(payload) { replies.push(payload); },
    async update(payload) { updates.push(payload); },
    ...overrides,
  });
}

async function seedAlert(overrides = {}) {
  const { user = 'flow-user', yard = '1020', model = '4RUNNER' } = overrides;
  return searches.addSavedSearch(user, 'Fixture only', yard, 'Fixture yard', 'TOYOTA', model, '2099', 'ACTIVE', '');
}

test.before(setupDatabase);
test.beforeEach(async () => {
  await run('DELETE FROM saved_searches');
  await run('DELETE FROM vehicles');
  for (const [make, model, year, status] of [
    ['BMW', '3 SERIES', 2008, 'ACTIVE'], ['BMW', '320I', 2008, 'ACTIVE'],
    ['BMW', '323', 2008, 'ACTIVE'], ['BMW', '328I', 2008, 'ACTIVE'],
    ['INFINITI', 'M35', 2008, 'ACTIVE'], ['LEXUS', 'RX330', 2008, 'ACTIVE'],
    ['TOYOTA', '4RUNNER', 2008, 'ACTIVE'], ['TOYOTA', '4 RUNNER', 2009, 'ACTIVE'],
    ['VW', 'GOLF', 2005, 'INACTIVE'],
  ]) {
    await run('INSERT INTO vehicles (yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, vehicle_status, first_seen, last_updated) VALUES (1020, ?, ?, ?, ?, ?, ?, ?)',
      ['BOISE', make, model, year, status, '2026-09-09', '2026-09-10']);
  }
});
test.after(async () => {
  await promisify(db.close).call(db);
  fs.rmSync(fixtureDirectory, { recursive: true });
  if (previousDatabasePath === undefined) delete process.env.VEHICLE_DB_PATH;
  else process.env.VEHICLE_DB_PATH = previousDatabasePath;
});

test('BMW family spellings produce the same complete matches without unrelated makes', async () => {
  for (const spelling of ['3 SERIES', '3series', '3-series', ' 3 series ']) {
    const rows = await queries.queryVehicles('ALL', 'BMW', spelling, '2006-2011', 'ACTIVE');
    assert.deepEqual(rows.map((row) => row.vehicle_model).sort(), ['3 SERIES', '320I', '323', '328I']);
  }
  const unscoped = await queries.queryVehicles('ALL', 'ANY', '3 SERIES', 'ANY', 'ACTIVE');
  assert(unscoped.every((row) => row.vehicle_make === 'BMW'));
  assert.equal(unscoped.length, 4);
  assert.deepEqual(await queries.queryVehicles('ALL', 'LEXUS', '3 SERIES', 'ANY', 'ACTIVE'), []);
});

test('spacing, typo recovery, family suggestions, and historical autocomplete agree', async () => {
  const compact = await queries.queryVehicles('ALL', 'TOYOTA', '4runner', 'ANY', 'ACTIVE');
  const spaced = await queries.queryVehicles('ALL', 'TOYOTA', '4 runner', 'ANY', 'ACTIVE');
  assert.deepEqual(compact, spaced);
  assert.equal(compact.length, 2);
  for (const value of ['4runner', '4 runner', '4runer', '4runnre']) {
    const choices = await queries.getModelSuggestions('TOYOTA', value);
    assert.deepEqual(choices.map((row) => normalizeModelForLooseComparison(row.model)), ['4RUNNER']);
  }
  assert((await queries.getModelSuggestions('BMW', '3series')).some((row) => row.model === '3 SERIES'));
  assert.deepEqual(await queries.getModelSuggestions('VOLKSWAGEN', 'golf'), [{ model: 'GOLF' }]);
  assert.deepEqual(await queries.queryVehicles('ALL', 'TOYOTA', '4runer', 'ANY', 'ACTIVE'), []);
});

test('family expansion cannot escape a saved alert’s yard, year, or inventory status', async () => {
  await run("UPDATE vehicles SET vehicle_status = 'NEW' WHERE vehicle_model = '320I'");
  await run("UPDATE vehicles SET vehicle_status = 'INACTIVE' WHERE vehicle_model = '323'");
  assert.equal((await queries.queryVehicles(1020, 'ANY', '3series', '2008', 'ACTIVE')).length, 3);
  assert.deepEqual((await queries.queryVehicles(1020, 'ANY', '3series', '2008', 'NEW')).map((row) => row.vehicle_model), ['320I']);
  assert.deepEqual((await queries.queryVehicles(1020, 'ANY', '3series', '2008', 'INACTIVE')).map((row) => row.vehicle_model), ['323']);
  assert.deepEqual(await queries.queryVehicles(1021, 'ANY', '3series', '2008', 'ACTIVE'), []);
  assert.deepEqual(await queries.queryVehicles(1020, 'ANY', '3series', '2099', 'ACTIVE'), []);
});

test('invalid years stop before search or save and never turn into all-year queries', async () => {
  for (const year of ['banana', '2011-2006', '2008oops', '2008,invalid']) {
    const interaction = makeSearch({ make: 'TOYOTA', model: '4RUNNER', year });
    await handleSearchCommand(interaction, { queryVehicles: async () => assert.fail('invalid years queried inventory') });
    assert.deepEqual(interaction.responseMethods, ['deferReply', 'editReply']);
    assert.match(interaction.replies[0].embeds[0].data.description, /four-digit year/);
    const save = component('search:save', { user: interaction.user });
    await interaction.message.collector.emitCollect(save);
    assert.match(save.replies[0].content, /Fix.*before saving/);
  }
  assert.deepEqual(await searches.getSavedSearches('user-1'), []);
});

test('legacy saved year filters retain their previous query behavior', async () => {
  const rows = await queries.queryVehicles('ALL', 'TOYOTA', '4RUNNER', '2008oops, invalid', 'ACTIVE');
  assert.deepEqual(rows.map((row) => row.vehicle_year), [2008]);
});

test('blank or punctuation-only model input stops before querying or saving', async () => {
  for (const model of ['   ', '---', '%_%']) {
    const interaction = makeSearch({ make: 'TOYOTA', model });
    await handleSearchCommand(interaction, { queryVehicles: async () => assert.fail('invalid model queried inventory') });
    assert.deepEqual(interaction.responseMethods, ['deferReply', 'editReply']);
    assert.match(interaction.replies[0].embeds[0].data.description, /Enter a model name/);
  }
  assert.deepEqual(await searches.getSavedSearches('user-1'), []);
});

test('autocomplete finds uncommon models beyond the first 250 and omits unusable Discord choices', async () => {
  await run(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n < 251)
    INSERT INTO vehicles (yard_id, vehicle_make, vehicle_model, vehicle_status)
    SELECT 1020, 'TOYOTA', 'POPULAR' || n, 'ACTIVE' FROM numbers`);
  for (const model of ['ZZRARE800', '', '---', 'TOOLONG'.repeat(20)]) {
    await run('INSERT INTO vehicles (yard_id, vehicle_make, vehicle_model, vehicle_status) VALUES (1020, ?, ?, ?)', ['TOYOTA', model, 'ACTIVE']);
  }
  assert.deepEqual(await queries.getModelSuggestions('TOYOTA', 'zzrare800'), [{ model: 'ZZRARE800' }]);
  assert.deepEqual(await queries.getModelSuggestions('TOYOTA', 'toolong'), []);
  const choices = await queries.getModelSuggestions('TOYOTA', '');
  assert.equal(choices.length, 25);
  assert(choices.every((row) => row.model.length <= 100 && normalizeModelForLooseComparison(row.model)));
});

test('choosing a typo suggestion reruns the search and saves exactly the selected model', async () => {
  const interaction = makeSearch({ make: 'TOYOTA', model: '4runer' }, 'flow-user');
  await handleSearchCommand(interaction);
  assert.equal(interaction.replies[0].embeds[0].data.footer.text, '0 matches');
  const menu = interaction.replies[0].components[3].components[0];
  const model = menu.options[0].data.value;
  const select = component(menu.data.custom_id, { values: [model] });
  await interaction.message.collector.emitCollect(select);
  assert.deepEqual(select.responseMethods, ['deferUpdate', 'editReply']);
  assert.equal(select.updates[0].embeds[0].data.fields.length, 2);
  assert(!select.updates[0].components.some((row) => row.components[0].data.custom_id === 'search:model'));
  assert(select.updates[0].components.some((row) => row.components[0].data.custom_id === 'search:group'));
  await interaction.message.collector.emitCollect(component('search:save'));
  const [saved] = await searches.getSavedSearches('flow-user');
  assert.equal(saved.model, model.toUpperCase());
  assert.equal((await queries.queryVehicles(saved.yard_id, saved.make, saved.model, saved.year_range, saved.status)).length, 2);
});

test('zero-result search saves, appears through All and grouped-yard managers, and deduplicates equivalent models', async () => {
  const interaction = makeSearch({ make: 'TOYOTA', model: '4 RUNNER', year: '2099' }, 'flow-user');
  await handleSearchCommand(interaction);
  assert.equal(interaction.replies[0].embeds[0].data.footer.text, '0 matches');
  const save = component(getButtonByLabel(interaction.replies[0], 'Save Alert').data.custom_id);
  await interaction.message.collector.emitCollect(save);
  assert.deepEqual(save.responseMethods, ['deferReply', 'editReply']);
  const allRows = await searches.getSavedSearches('flow-user', 'ALL');
  assert.equal(allRows.length, 1);
  assert.equal(allRows[0].frequency, 'daily');
  const privateManager = makeManager('flow-user');
  const manage = component(getButtonByLabel(interaction.replies[0], 'Manage Alerts').data.custom_id, {
    fetchReply: privateManager.fetchReply,
  });
  await interaction.message.collector.emitCollect(manage);
  assert.deepEqual(manage.deferOptions, { ephemeral: true });
  assert.match(manage.replies[0].embeds[0].data.title, /TOYOTA 4 RUNNER/);
  for (const location of ['all', 'TreasureValleyYards', 'boise']) {
    const manager = makeManager('flow-user', location);
    await handleSavedSearchCommand(manager);
    assert.match(manager.editReplyCalls[0].embeds[0].data.title, /TOYOTA 4 RUNNER/);
  }
  const equivalent = makeSearch({ make: 'toyota', model: '4runner', year: '2099' }, 'flow-user');
  await handleSearchCommand(equivalent);
  const secondSave = component(getButtonByLabel(equivalent.replies[0], 'Save Alert').data.custom_id);
  await equivalent.message.collector.emitCollect(secondSave);
  assert.match(secondSave.replies[0].content, /already saved/);
  assert.equal((await searches.getSavedSearches('flow-user')).length, 1);
});

test('legacy grouped-yard ordering and make aliases deduplicate without altering stored rows', async () => {
  const id = await searches.addSavedSearch('flow-user', 'Fixture', '1021, 1020', 'Original name', 'VW', 'GOLF', 'ANY', 'ACTIVE', 'keep');
  const before = await searches.getSavedSearches('flow-user');
  assert.equal(await searches.checkExistingSearch('flow-user', [1020, 1021], 'VOLKSWAGEN', 'golf', 'Any', 'ACTIVE'), true);
  assert.deepEqual((await searches.getSavedSearches('flow-user', convertLocationToYardId('TreasureValleyYards'))).map((row) => row.id), [id]);
  assert.deepEqual(await searches.getSavedSearches('flow-user'), before);
  assert.deepEqual(await searches.getSavedSearches('different-user', 'ALL'), []);
});

test('manager pause, resume, cancel, and confirmed removal change only the selected alert', async () => {
  const id = await seedAlert();
  const unrelated = await seedAlert({ model: 'CAMRY' });
  await seedAlert({ user: 'different-user' });
  const originalOther = (await searches.getSavedSearches('flow-user'))[1];
  const manager = makeManager('flow-user');
  await handleSavedSearchCommand(manager);
  let payload = manager.editReplyCalls[0];
  for (const [label, frequency] of [['Pause Alerts', 'paused'], ['Resume Alerts', 'daily']]) {
    const action = component(getButtonByLabel(payload, label).data.custom_id);
    await manager.__collector.emitCollect(action);
    assert.deepEqual(action.responseMethods, ['deferUpdate', 'editReply']);
    assert.equal((await searches.getSavedSearches('flow-user'))[0].frequency, frequency);
    payload = action.updates[0];
  }
  const request = component(getButtonByLabel(payload, 'Delete').data.custom_id);
  await manager.__collector.emitCollect(request);
  assert.equal((await searches.getSavedSearches('flow-user')).length, 2);
  const cancel = component(getButtonByLabel(request.updates[0], 'Keep Alert').data.custom_id);
  await manager.__collector.emitCollect(cancel);
  assert.equal((await searches.getSavedSearches('flow-user')).length, 2);
  const confirm = component(`confirm-delete:0:${id}`);
  await manager.__collector.emitCollect(confirm);
  assert.match(confirm.replies[0].content, /cancelled/);
  assert.equal((await searches.getSavedSearches('flow-user')).length, 2);
  await manager.__collector.emitCollect(component(`delete:0:${id}`));
  await manager.__collector.emitCollect(component(`confirm-delete:0:${id}`));
  assert.deepEqual(await searches.getSavedSearches('flow-user'), [originalOther]);
  const staleDelete = component(`confirm-delete:0:${id}`);
  await manager.__collector.emitCollect(staleDelete);
  assert.match(staleDelete.replies[0].content, /view has changed/);
  assert.equal((await searches.getSavedSearches('flow-user'))[0].id, unrelated);
  assert.equal((await searches.getSavedSearches('different-user')).length, 1);
});

test('slow pause acknowledges first and repeated clicks cannot mutate a second alert', async () => {
  const id = await seedAlert();
  const manager = makeManager('flow-user');
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const action = component(`pause:0:${id}`);
  let writes = 0;
  const command = createSavedSearchCommand({
    getSavedSearches: searches.getSavedSearches,
    async setSavedSearchFrequency(...args) {
      assert.equal(action.deferred, true);
      writes += 1;
      await pending;
      return searches.setSavedSearchFrequency(...args);
    },
  });
  await command(manager);
  const first = manager.__collector.emitCollect(action);
  await setImmediate();
  const repeated = component(`pause:0:${id}`);
  await manager.__collector.emitCollect(repeated);
  assert.match(repeated.replies[0].content, /Still processing/);
  const failedBusyReply = component(`pause:0:${id}`, { async reply() { throw new Error('fixture reply failed'); } });
  await captureConsole(() => manager.__collector.emitCollect(failedBusyReply));
  await manager.__collector.emitEnd([], 'time');
  assert.equal(manager.editReplyCalls.length, 1);
  release();
  await first;
  assert.equal(writes, 1);
  assert.deepEqual(action.responseMethods, ['deferUpdate', 'editReply']);
  assert.deepEqual(manager.editReplyCalls.at(-1).components, []);
  assert.match(manager.editReplyCalls.at(-1).content, /expired/);
});

test('a slow search update cannot resurrect expired controls and repeated clicks do not overlap', async () => {
  const interaction = makeSearch({ make: 'TOYOTA', model: '4RUNNER' }, 'flow-user');
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let queriesRun = 0;
  await handleSearchCommand(interaction, {
    ...queries,
    async queryVehicles(...args) {
      queriesRun += 1;
      if (queriesRun > 1) await pending;
      return queries.queryVehicles(...args);
    },
  });
  const action = component('search:relocate', { values: ['caldwell'] });
  const first = interaction.message.collector.emitCollect(action);
  await setImmediate();
  assert.equal(action.deferred, true);
  const repeated = component('search:relocate', { values: ['boise'] });
  await interaction.message.collector.emitCollect(repeated);
  assert.match(repeated.replies[0].content, /Still processing/);
  const failedBusyReply = component('search:next', { async reply() { throw new Error('fixture reply failed'); } });
  await captureConsole(() => interaction.message.collector.emitCollect(failedBusyReply));
  await interaction.message.collector.emitEnd();
  assert.equal(interaction.replies.length, 1);
  release();
  await first;
  assert.equal(queriesRun, 2);
  assert.equal(action.updates.length, 1);
  assert.deepEqual(interaction.replies.at(-1).components, []);
  assert.match(interaction.replies.at(-1).content, /expired/);
  assert.deepEqual(interaction.message.edits, []);
});

test('failed UI update after a persisted pause advises reopening instead of claiming nothing changed', async () => {
  const id = await seedAlert();
  const manager = makeManager('flow-user');
  await handleSavedSearchCommand(manager);
  const action = component(`pause:0:${id}`, { async update() { throw new Error('fixture Discord failure'); } });
  await captureConsole(() => manager.__collector.emitCollect(action));
  assert.equal((await searches.getSavedSearches('flow-user'))[0].frequency, 'paused');
  assert.match(action.replies[0].content, /Unable to confirm.*Reopen/);
  assert.deepEqual(action.responseMethods, ['deferUpdate', 'editReply', 'followUp']);
});

test('Test DMs reports successful and blocked delivery without changing saved alerts', async () => {
  await seedAlert();
  const before = await searches.getSavedSearches('flow-user');
  const manager = makeManager('flow-user');
  await handleSavedSearchCommand(manager);
  for (const blocked of [false, true]) {
    const action = component('test-dm', {
      user: { id: 'flow-user', async send(content) {
        assert.match(content, /DM test/);
        if (blocked) throw Object.assign(new Error('fixture blocked'), { code: 50007 });
      } },
    });
    await captureConsole(() => manager.__collector.emitCollect(action));
    assert.match(action.replies[0].content, blocked ? /could not send.*Allow direct messages/ : /Test DM sent/);
    assert.deepEqual(action.responseMethods, ['deferUpdate', 'followUp']);
  }
  assert.deepEqual(await searches.getSavedSearches('flow-user'), before);
});

test('failed Discord error notices stay contained and redact private details', async () => {
  const id = await seedAlert();
  const manager = makeManager('flow-user');
  const search = makeSearch({ make: 'TOYOTA', model: '4RUNNER' }, 'flow-user');
  await handleSavedSearchCommand(manager);
  await handleSearchCommand(search);
  const privateDetails = 'fixture private account id';
  for (const [collector, customId] of [[manager.__collector, `pause:0:${id}`], [search.message.collector, 'search:relocate']]) {
    const action = component(customId, {
      values: ['caldwell'],
      async update() { throw new Error(privateDetails); },
      async reply() { throw new URIError(privateDetails); },
    });
    const output = joinedConsoleText(await captureConsole(() => collector.emitCollect(action)));
    assert.match(output, /Unable to report.*URIError/);
    assert(!output.includes(privateDetails));
  }
});
