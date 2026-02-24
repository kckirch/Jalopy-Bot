const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const savedSearchCommandPath = path.join(repoRoot, 'src/bot/commands/savedSearchCommand.js');
const savedSearchManagerPath = path.join(repoRoot, 'src/database/savedSearchManager.js');
const vehicleQueryManagerPath = path.join(repoRoot, 'src/database/vehicleQueryManager.js');

class FakeCollector {
  constructor() {
    this.handlers = {};
    this.stopCalls = [];
  }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
    return this;
  }

  async emitCollect(interaction) {
    if (this.handlers.collect) {
      await this.handlers.collect(interaction);
    }
  }

  async emitEnd(...args) {
    if (this.handlers.end) {
      await this.handlers.end(...args);
    }
  }

  stop(reason) {
    this.stopCalls.push(reason);
  }
}

function getButtonByLabel(payload, label) {
  return payload.components[0].components.find((button) => button.data.label === label);
}

function makeInteraction(userId = 'user-1', location = null) {
  const collector = new FakeCollector();
  const replyMessage = {
    createMessageComponentCollector: () => collector,
  };

  return {
    user: {
      id: userId,
      tag: `${userId}#0001`,
    },
    options: {
      getString(name) {
        if (name === 'location') return location;
        return null;
      },
    },
    deferReplyCalls: [],
    editReplyCalls: [],
    async deferReply(payload) {
      this.deferReplyCalls.push(payload);
    },
    async editReply(payload) {
      this.editReplyCalls.push(payload);
    },
    async fetchReply() {
      return replyMessage;
    },
    __collector: collector,
  };
}

async function withSavedSearchCommandMocks(mocks, runTest) {
  const previousSavedSearchCommand = require.cache[savedSearchCommandPath];
  const previousSavedSearchManager = require.cache[savedSearchManagerPath];
  const previousVehicleQueryManager = require.cache[vehicleQueryManagerPath];

  require.cache[savedSearchManagerPath] = {
    id: savedSearchManagerPath,
    filename: savedSearchManagerPath,
    loaded: true,
    exports: {
      getSavedSearches: mocks.getSavedSearches || (async () => []),
      deleteSavedSearch: mocks.deleteSavedSearch || (async () => {}),
      setSavedSearchFrequency: mocks.setSavedSearchFrequency || (async () => {}),
    },
  };

  require.cache[vehicleQueryManagerPath] = {
    id: vehicleQueryManagerPath,
    filename: vehicleQueryManagerPath,
    loaded: true,
    exports: {
      queryVehicles: mocks.queryVehicles || (async () => []),
      getModelSuggestionsForNoResults: mocks.getModelSuggestionsForNoResults || (async () => []),
    },
  };

  delete require.cache[savedSearchCommandPath];

  try {
    const { handleSavedSearchCommand } = require(savedSearchCommandPath);
    await runTest(handleSavedSearchCommand);
  } finally {
    if (previousSavedSearchCommand) require.cache[savedSearchCommandPath] = previousSavedSearchCommand;
    else delete require.cache[savedSearchCommandPath];

    if (previousSavedSearchManager) require.cache[savedSearchManagerPath] = previousSavedSearchManager;
    else delete require.cache[savedSearchManagerPath];

    if (previousVehicleQueryManager) require.cache[vehicleQueryManagerPath] = previousVehicleQueryManager;
    else delete require.cache[vehicleQueryManagerPath];
  }
}

test('savedsearch command replies with no-results message when user has no saved searches', async () => {
  const interaction = makeInteraction('user-empty');

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [],
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.deferReplyCalls[0].ephemeral, true);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0].content, /no saved searches/i);
});

test('savedsearch command renders in-channel carousel with requested actions', async () => {
  const interaction = makeInteraction('user-has-searches');

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 1,
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: '2000-2005',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
    }
  );

  assert.equal(interaction.editReplyCalls.length, 1);
  const initialPayload = interaction.editReplyCalls[0];
  assert.ok(Array.isArray(initialPayload.embeds));
  assert.ok(Array.isArray(initialPayload.components));
  const labels = initialPayload.components[0].components.map((button) => button.data.label);
  assert.deepEqual(labels, ['Prev Saved', 'Next Saved', 'Run', 'Delete', 'Pause Alerts']);
});

test('run button switches to /search-style results view with pagination controls', async () => {
  const interaction = makeInteraction('user-run-test');
  let updatedPayload;

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 99,
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
      queryVehicles: async () => [
        {
          vehicle_year: 2005,
          vehicle_make: 'TOYOTA',
          vehicle_model: 'CAMRY',
          yard_name: 'BOISE',
          row_number: 50,
          first_seen: new Date().toISOString(),
          last_updated: new Date().toISOString(),
        },
      ],
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      const runCustomId = getButtonByLabel(interaction.editReplyCalls[0], 'Run').data.custom_id;

      await interaction.__collector.emitCollect({
        customId: runCustomId,
        user: { id: 'user-run-test' },
        async update(payload) {
          updatedPayload = payload;
        },
        async reply() {},
      });
    }
  );

  assert.ok(Array.isArray(updatedPayload.embeds));
  const embedData = updatedPayload.embeds[0].data;
  assert.match(embedData.title, /Database search results for/i);
  assert.ok(Array.isArray(embedData.fields));
  assert.ok(embedData.fields.some((field) => /TOYOTA CAMRY/i.test(field.name)));
  const labels = updatedPayload.components[0].components.map((button) => button.data.label);
  assert.deepEqual(labels, ['Previous', 'Next', 'Back To Saved', 'Delete', 'Pause Alerts']);
});

test('back-to-saved button returns from results view to saved carousel view', async () => {
  const interaction = makeInteraction('user-back-test');
  const updates = [];

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 101,
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
      queryVehicles: async () => [
        {
          vehicle_year: 2005,
          vehicle_make: 'TOYOTA',
          vehicle_model: 'CAMRY',
          yard_name: 'BOISE',
          row_number: 50,
          first_seen: new Date().toISOString(),
          last_updated: new Date().toISOString(),
        },
      ],
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      const runCustomId = getButtonByLabel(interaction.editReplyCalls[0], 'Run').data.custom_id;

      await interaction.__collector.emitCollect({
        customId: runCustomId,
        user: { id: 'user-back-test' },
        async update(payload) {
          updates.push(payload);
        },
        async reply() {},
      });

      const backCustomId = getButtonByLabel(updates[0], 'Back To Saved').data.custom_id;
      await interaction.__collector.emitCollect({
        customId: backCustomId,
        user: { id: 'user-back-test' },
        async update(payload) {
          updates.push(payload);
        },
        async reply() {},
      });
    }
  );

  assert.equal(updates.length, 2);
  assert.match(updates[0].embeds[0].data.title, /Database search results/i);
  assert.match(updates[1].embeds[0].data.title, /Saved Search:/i);
  const labels = updates[1].components[0].components.map((button) => button.data.label);
  assert.deepEqual(labels, ['Prev Saved', 'Next Saved', 'Run', 'Delete', 'Pause Alerts']);
});

test('pause button toggles alerts and persists paused frequency', async () => {
  const interaction = makeInteraction('user-pause-test');
  const frequencyUpdates = [];
  let updatedPayload;

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 55,
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'HONDA',
          model: 'CIVIC',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
      setSavedSearchFrequency: async (searchId, frequency) => {
        frequencyUpdates.push([searchId, frequency]);
      },
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      const pauseCustomId = getButtonByLabel(interaction.editReplyCalls[0], 'Pause Alerts').data.custom_id;

      await interaction.__collector.emitCollect({
        customId: pauseCustomId,
        user: { id: 'user-pause-test' },
        async update(payload) {
          updatedPayload = payload;
        },
        async reply() {},
      });
    }
  );

  assert.deepEqual(frequencyUpdates, [[55, 'paused']]);
  const pauseButton = getButtonByLabel(updatedPayload, 'Resume Alerts');
  assert.ok(pauseButton);
  assert.match(updatedPayload.embeds[0].data.description, /alerts:\s+paused/i);
});

test('delete button removes saved search and clears message when last item is deleted', async () => {
  const interaction = makeInteraction('user-delete-test');
  const deleteCalls = [];
  let updatedPayload;

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 42,
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'HONDA',
          model: 'CIVIC',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
      deleteSavedSearch: async (id) => {
        deleteCalls.push(id);
      },
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      const deleteCustomId = getButtonByLabel(interaction.editReplyCalls[0], 'Delete').data.custom_id;

      await interaction.__collector.emitCollect({
        customId: deleteCustomId,
        user: { id: 'user-delete-test' },
        async update(payload) {
          updatedPayload = payload;
        },
        async reply() {},
      });
    }
  );

  assert.deepEqual(deleteCalls, [42]);
  assert.match(updatedPayload.content, /all saved searches have been deleted/i);
  assert.deepEqual(updatedPayload.components, []);
});

test('next and previous buttons cycle through saved searches in place', async () => {
  const interaction = makeInteraction('user-nav-test');
  const updates = [];

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 1,
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
        {
          id: 2,
          yard_id: '1021',
          yard_name: 'CALDWELL',
          make: 'HONDA',
          model: 'ACCORD',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);

      const nextCustomId = getButtonByLabel(interaction.editReplyCalls[0], 'Next Saved').data.custom_id;
      await interaction.__collector.emitCollect({
        customId: nextCustomId,
        user: { id: 'user-nav-test' },
        async update(payload) {
          updates.push(payload);
        },
        async reply() {},
      });

      const prevCustomId = getButtonByLabel(updates[0], 'Prev Saved').data.custom_id;
      await interaction.__collector.emitCollect({
        customId: prevCustomId,
        user: { id: 'user-nav-test' },
        async update(payload) {
          updates.push(payload);
        },
        async reply() {},
      });
    }
  );

  assert.equal(updates.length, 2);
  assert.match(updates[0].embeds[0].data.title, /HONDA ACCORD/i);
  assert.match(updates[1].embeds[0].data.title, /TOYOTA CAMRY/i);
});

test('carousel collector end disables components on the ephemeral reply', async () => {
  const interaction = makeInteraction('user-end-test');

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 1,
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'daily',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      await interaction.__collector.emitEnd([], 'time');
    }
  );

  assert.equal(interaction.editReplyCalls.length, 2);
  assert.deepEqual(interaction.editReplyCalls[1].components, []);
});
