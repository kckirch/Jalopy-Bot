const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const { SEARCH_LOCATION_CHOICES } = require('../src/bot/locationChoices');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const {
  makeInteraction,
  withSearchCommandMocks,
} = require('../test-support/searchCommandHarness');

test('invalid make returns ephemeral validation embed and stops query', async () => {
  let queryCalled = false;
  const interaction = makeInteraction({
    location: 'boise',
    make: 'not-a-real-make',
    model: 'ANY',
    year: 'ANY',
    status: 'ACTIVE',
  });

  const consoleCalls = await captureConsole(async () => {
    await withSearchCommandMocks(
      {
        queryVehicles: async () => {
          queryCalled = true;
          return [];
        },
        checkExistingSearch: async () => false,
        addSavedSearch: async () => {},
      },
      async ({ handleSearchCommand }) => handleSearchCommand(interaction)
    );
  });

  assert.equal(queryCalled, false);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.deferOptions.flags, MessageFlags.Ephemeral);
  assert.equal(interaction.replies[0].embeds[0].data.title, 'Let’s fix this search');
  assert.equal(interaction.replies[0].components[0].components[0].data.label, 'Edit Search');
  assert.equal(joinedConsoleText(consoleCalls).toLowerCase().includes('not-a-real-make'), false);
});

test('make aliases are normalized before querying vehicles', async () => {
  const queryCalls = [];
  const interaction = makeInteraction({
    location: 'boise',
    make: 'chevy',
    model: 'ANY',
    year: 'ANY',
    status: 'ACTIVE',
  });

  await withSearchCommandMocks(
    {
      queryVehicles: async (...args) => {
        queryCalls.push(args);
        return [];
      },
    },
    async ({ handleSearchCommand }) => handleSearchCommand(interaction)
  );

  assert.deepEqual(queryCalls, [[1020, 'CHEVROLET', 'ANY', 'ANY', 'ACTIVE']]);
});

test('location defaults to all yards', async () => {
  let queryCalled = false;
  const interaction = makeInteraction({
    make: 'TOYOTA',
    model: 'ANY',
    year: 'ANY',
    status: 'ACTIVE',
  });

  await withSearchCommandMocks(
    {
      queryVehicles: async (yardId) => {
        queryCalled = true;
        assert.equal(yardId, 'ALL');
        return [];
      },
    },
    async ({ handleSearchCommand }) => handleSearchCommand(interaction)
  );

  assert.equal(queryCalled, true);
  assert.deepEqual(interaction.responseMethods, ['deferReply', 'editReply']);
});

test('no-result search responds with no-results embed and disabled pagination', async () => {
  const interaction = makeInteraction({
    location: 'boise',
    make: 'ANY',
    model: 'ANY',
    year: 'ANY',
    status: 'ACTIVE',
  });

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [],
      checkExistingSearch: async () => false,
      addSavedSearch: async () => {},
    },
    async ({ handleSearchCommand }) => handleSearchCommand(interaction)
  );

  assert.equal(interaction.replies.length, 1);
  const payload = interaction.replies[0];
  assert.match(payload.embeds[0].data.description, /No vehicles match/);

  const buttons = payload.components[0].components.map((component) => component.data);
  assert.equal(buttons[0].label, 'Previous');
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].label, 'Next');
  assert.equal(buttons[1].disabled, true);
  assert.equal(buttons[2].label, 'Save Alert');

  await interaction.message.collector.emitEnd();
  assert.equal(interaction.message.edits.length, 1);
  assert.deepEqual(interaction.message.edits[0].components, []);
});

test('a recognized formatting variant does not suggest the same model back', async () => {
  const interaction = makeInteraction({
    location: 'boise',
    make: 'MAZDA',
    model: 'RX7',
    year: 'ANY',
    status: 'ACTIVE',
  });

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [],
      getModelSuggestionsForNoResults: async () => ['RX-7', 'RX 7', 'RX8'],
      checkExistingSearch: async () => false,
      addSavedSearch: async () => {},
    },
    async ({ handleSearchCommand }) => handleSearchCommand(interaction)
  );

  assert.equal(interaction.replies.length, 1);
  const payload = interaction.replies[0];
  assert.match(payload.embeds[0].data.description, /recognized/i);
  assert.doesNotMatch(payload.embeds[0].data.description, /Suggested model names/i);
  assert(!payload.components.some((row) => row.components[0].data.custom_id === 'search:model'));
});

test('location dropdown reruns search with same filters in selected location', async () => {
  const now = new Date().toISOString();
  const interaction = makeInteraction({
    location: 'boise',
    make: 'TOYOTA',
    model: 'CAMRY',
    year: '2005',
    status: 'ACTIVE',
  });
  const queriedYardIds = [];

  await withSearchCommandMocks(
    {
      queryVehicles: async (yardId) => {
        queriedYardIds.push(yardId);
        const rowsByYard = {
          1020: [{ yard_name: 'BOISE', row_number: 2, vehicle_year: 2005 }],
          1021: [{ yard_name: 'CALDWELL', row_number: 10, vehicle_year: 2006 }],
        };
        return (rowsByYard[yardId] || []).map((row) => ({
          vehicle_make: 'TOYOTA',
          vehicle_model: 'CAMRY',
          first_seen: now,
          last_updated: now,
          notes: '',
          ...row,
        }));
      },
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);

      const relocateMenu = interaction.replies[0].components[2].components[0];
      assert.deepEqual(
        relocateMenu
          .toJSON()
          .options.map(({ label, value }) => ({ label, value })),
        SEARCH_LOCATION_CHOICES.map(({ name, value }) => ({ label: name, value }))
      );
      const selectInteraction = {
        customId: relocateMenu.data.custom_id,
        values: ['caldwell'],
        user: { id: 'user-1', tag: 'user-1#0001' },
        updates: [],
        async update(payload) {
          this.updates.push(payload);
        },
        async reply() {},
      };

      await interaction.message.collector.emitCollect(selectInteraction);

      assert.deepEqual(queriedYardIds, [1020, 1021]);
      assert.equal(selectInteraction.updates.length, 1);
      assert.match(selectInteraction.updates[0].embeds[0].data.description, /Location: caldwell/i);
    }
  );
});
