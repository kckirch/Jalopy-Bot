const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const savedSearchCommandPath = path.join(repoRoot, 'src/bot/commands/savedSearchCommand.js');
const savedSearchSessionHandlerPath = path.join(
  repoRoot,
  'src/bot/handlers/savedSearchSessionHandler.js'
);
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

function makeVehicleRow(index) {
  return {
    vehicle_year: 2000 + index,
    vehicle_make: 'TOYOTA',
    vehicle_model: 'CAMRY',
    yard_name: 'BOISE',
    row_number: index + 1,
    first_seen: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    last_updated: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
  };
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
  const previousSavedSearchSessionHandler =
    require.cache[savedSearchSessionHandlerPath];
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

  delete require.cache[savedSearchSessionHandlerPath];
  delete require.cache[savedSearchCommandPath];

  try {
    const { handleSavedSearchCommand } = require(savedSearchCommandPath);
    await runTest(handleSavedSearchCommand);
  } finally {
    if (previousSavedSearchCommand) require.cache[savedSearchCommandPath] = previousSavedSearchCommand;
    else delete require.cache[savedSearchCommandPath];

    if (previousSavedSearchSessionHandler) {
      require.cache[savedSearchSessionHandlerPath] =
        previousSavedSearchSessionHandler;
    } else {
      delete require.cache[savedSearchSessionHandlerPath];
    }

    if (previousSavedSearchManager) require.cache[savedSearchManagerPath] = previousSavedSearchManager;
    else delete require.cache[savedSearchManagerPath];

    if (previousVehicleQueryManager) require.cache[vehicleQueryManagerPath] = previousVehicleQueryManager;
    else delete require.cache[vehicleQueryManagerPath];
  }
}

test('savedsearch command replies with no-results message when user has no saved searches', async () => {
  const interaction = makeInteraction('user-empty');

  const consoleCalls = await captureConsole(async () => {
    await withSavedSearchCommandMocks(
      {
        getSavedSearches: async () => [],
      },
      async (handleSavedSearchCommand) => {
        await handleSavedSearchCommand(interaction);
      }
    );
  });

  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.deferReplyCalls[0].ephemeral, true);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0].content, /no saved searches/i);
  assert.equal(joinedConsoleText(consoleCalls).includes('user-empty'), false);
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

test('results pagination stays inside the active saved-search session', async () => {
  const interaction = makeInteraction('user-results-pages');
  const updates = [];

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 100,
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
      queryVehicles: async () =>
        Array.from({ length: 21 }, (_, index) => makeVehicleRow(index)),
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      const runCustomId = getButtonByLabel(
        interaction.editReplyCalls[0],
        'Run'
      ).data.custom_id;

      const emitAction = async (customId) => {
        await interaction.__collector.emitCollect({
          customId,
          user: { id: 'user-results-pages' },
          async update(payload) {
            updates.push(payload);
          },
          async reply() {},
        });
      };

      await emitAction(runCustomId);
      await emitAction(getButtonByLabel(updates[0], 'Next').data.custom_id);
      await emitAction(getButtonByLabel(updates[1], 'Previous').data.custom_id);
    }
  );

  assert.deepEqual(
    updates.map((payload) => payload.embeds[0].data.footer.text),
    ['Page 1 of 2', 'Page 2 of 2', 'Page 1 of 2']
  );
});

test('stale result controls and unknown actions receive bounded replies', async () => {
  const interaction = makeInteraction('user-stale-actions');
  const replies = [];

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 102,
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
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      const emitAction = async (customId) => {
        await interaction.__collector.emitCollect({
          customId,
          user: { id: 'user-stale-actions' },
          async update() {},
          async reply(payload) {
            replies.push(payload);
          },
        });
      };

      await emitAction('rnext');
      await emitAction('unknown');
    }
  );

  assert.deepEqual(replies, [
    {
      content: 'No search results are currently active.',
      ephemeral: true,
    },
    { content: 'Unknown action.', ephemeral: true },
  ]);
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

test('savedsearch command redacts retrieval errors', async () => {
  const privateErrorDetails = 'private user /home/kc/private-inventory.db';
  const interaction = makeInteraction('private-user');

  const consoleCalls = await captureConsole(async () => {
    await withSavedSearchCommandMocks(
      {
        getSavedSearches: async () => {
          throw new TypeError(privateErrorDetails);
        },
      },
      async (handleSavedSearchCommand) => {
        await handleSavedSearchCommand(interaction);
      }
    );
  });

  assert.deepEqual(interaction.editReplyCalls, [{
    content: 'Failed to retrieve saved searches.',
  }]);
  assert.match(joinedConsoleText(consoleCalls), /Error retrieving saved searches: TypeError/);
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('savedsearch command redacts collector action errors', async () => {
  const privateErrorDetails = 'private saved search /home/kc/private-inventory.db';
  const interaction = makeInteraction('user-collector-error');
  const buttonReplies = [];

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 81,
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
      deleteSavedSearch: async () => {
        throw new RangeError(privateErrorDetails);
      },
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      const deleteCustomId = getButtonByLabel(
        interaction.editReplyCalls[0],
        'Delete'
      ).data.custom_id;

      const consoleCalls = await captureConsole(async () => {
        await interaction.__collector.emitCollect({
          customId: deleteCustomId,
          user: { id: 'user-collector-error' },
          async update() {},
          async reply(payload) {
            buttonReplies.push(payload);
          },
        });
      });

      assert.deepEqual(buttonReplies, [{
        content: 'Unable to process that saved-search action right now.',
        ephemeral: true,
      }]);
      assert.match(joinedConsoleText(consoleCalls), /Saved search interaction failed: RangeError/);
      assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
    }
  );
});

test('savedsearch command redacts carousel cleanup errors', async () => {
  const privateErrorDetails = 'private message /home/kc/private-inventory.db';
  const interaction = makeInteraction('user-cleanup-error');

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 82,
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
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      interaction.editReply = async () => {
        throw new SyntaxError(privateErrorDetails);
      };

      const consoleCalls = await captureConsole(async () => {
        await interaction.__collector.emitEnd([], 'time');
      });

      assert.match(
        joinedConsoleText(consoleCalls),
        /Unable to disable saved-search carousel buttons: SyntaxError/
      );
      assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
    }
  );
});
