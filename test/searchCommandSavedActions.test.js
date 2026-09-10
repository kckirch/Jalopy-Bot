const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeSearchInteraction,
  makeVehicleRow,
  withSearchCommandMocks,
} = require('../test-support/searchCommandHarness');

test('save-search button flow calls checkExistingSearch and addSavedSearch', async () => {
  const interaction = makeSearchInteraction();
  const addSavedSearchCalls = [];
  const existingChecks = [];

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [makeVehicleRow()],
      checkExistingSearch: async (...args) => {
        existingChecks.push(args);
        return false;
      },
      addSavedSearch: async (...args) => addSavedSearchCalls.push(args),
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
      const customId = interaction.replies[0].components[0].components[2].data.custom_id;
      const buttonInteraction = {
        customId,
        user: { id: 'user-1', tag: 'user-1#0001' },
        replyCalls: [],
        async reply(payload) {
          this.replyCalls.push(payload);
        },
        async update() {},
      };

      await interaction.message.collector.emitCollect(buttonInteraction);

      assert.equal(existingChecks.length, 1);
      assert.equal(addSavedSearchCalls.length, 1);
      assert.equal(addSavedSearchCalls[0][0], 'user-1');
      assert.equal(addSavedSearchCalls[0][4], 'TOYOTA');
      assert.equal(addSavedSearchCalls[0][5], 'CAMRY');
      assert.equal(addSavedSearchCalls[0][6], '2005');
      assert.equal(buttonInteraction.replyCalls.length, 1);
      assert.match(buttonInteraction.replyCalls[0].content, /Alert saved: TOYOTA CAMRY/);
      assert.match(buttonInteraction.replyCalls[0].content, /Daily DM.*not just newly arrived/);
      assert.deepEqual(buttonInteraction.deferOptions, { ephemeral: true });
      assert.deepEqual(buttonInteraction.responseMethods, ['deferReply', 'editReply']);
    }
  );
});

test('save-search for ALL location uses canonical yard ID for duplicate detection and insert', async () => {
  const interaction = makeSearchInteraction({
    location: 'all',
    make: 'ANY',
    model: 'ANY',
    year: 'ANY',
  });
  const addSavedSearchCalls = [];
  const existingChecks = [];

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [
        makeVehicleRow({
          row_number: 1,
          vehicle_make: 'FORD',
          vehicle_model: 'FOCUS',
          vehicle_year: 2008,
        }),
      ],
      checkExistingSearch: async (...args) => {
        existingChecks.push(args);
        return false;
      },
      addSavedSearch: async (...args) => addSavedSearchCalls.push(args),
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
      const customId = interaction.replies[0].components[0].components[2].data.custom_id;
      await interaction.message.collector.emitCollect({
        customId,
        user: { id: 'user-1', tag: 'user-1#0001' },
        async reply() {},
        async update() {},
      });
    }
  );

  const expectedCanonicalAll = '1020,1021,1022,1099,1119,999999';
  assert.equal(existingChecks.length, 1);
  assert.equal(existingChecks[0][1], expectedCanonicalAll);
  assert.equal(addSavedSearchCalls.length, 1);
  assert.equal(addSavedSearchCalls[0][2], expectedCanonicalAll);
});

test('duplicate saved search does not call addSavedSearch', async () => {
  const interaction = makeSearchInteraction();
  let addCalls = 0;
  let duplicateReply;

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [makeVehicleRow({ row_number: 2 })],
      checkExistingSearch: async () => true,
      addSavedSearch: async () => {
        addCalls += 1;
      },
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
      const customId = interaction.replies[0].components[0].components[2].data.custom_id;
      await interaction.message.collector.emitCollect({
        customId,
        user: { id: 'user-1', tag: 'user-1#0001' },
        async reply(payload) {
          duplicateReply = payload;
        },
        async update() {},
      });
    }
  );

  assert.equal(addCalls, 0);
  assert.match(duplicateReply.content, /already saved.*settings have not changed/);
});

test('manage-alerts result action opens the existing private manager without deleting', async () => {
  const interaction = makeSearchInteraction();
  const deletedSearchIds = [];

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [makeVehicleRow({ row_number: 2 })],
      getSavedSearches: async () => [
        {
          id: 123,
          yard_id: '1020',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: '2005',
          status: 'ACTIVE',
        },
      ],
      deleteSavedSearch: async (id) => deletedSearchIds.push(id),
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
      const customId = interaction.replies[0].components[1].components[0].data.custom_id;
      const buttonInteraction = {
        customId,
        user: { id: 'user-1', tag: 'user-1#0001' },
        replyCalls: [],
        async reply(payload) {
          this.replyCalls.push(payload);
        },
        async update() {},
        async fetchReply() {
          return { createMessageComponentCollector: () => ({ on() {} }) };
        },
      };

      await interaction.message.collector.emitCollect(buttonInteraction);

      assert.deepEqual(deletedSearchIds, []);
      assert.equal(buttonInteraction.replyCalls.length, 1);
      assert.match(buttonInteraction.replyCalls[0].embeds[0].data.title, /Saved Search: TOYOTA CAMRY/);
      assert.deepEqual(buttonInteraction.deferOptions, { ephemeral: true });
    }
  );
});
