const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const searchCommandPath = path.join(repoRoot, 'src/bot/commands/searchCommand.js');
const vehicleQueryManagerPath = path.join(repoRoot, 'src/database/vehicleQueryManager.js');
const savedSearchManagerPath = path.join(repoRoot, 'src/database/savedSearchManager.js');

class FakeCollector {
  constructor() {
    this.handlers = {};
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
}

function makeMessage() {
  return {
    collector: null,
    edits: [],
    createMessageComponentCollector() {
      this.collector = new FakeCollector();
      return this.collector;
    },
    async edit(payload) {
      this.edits.push(payload);
    },
  };
}

function makeInteraction(options, userId = 'user-1') {
  const message = makeMessage();
  const replies = [];

  return {
    options: {
      getString(name) {
        return options[name] ?? null;
      },
    },
    user: {
      id: userId,
      tag: `${userId}#0001`,
    },
    async reply(payload) {
      replies.push(payload);
      if (payload && payload.fetchReply) {
        return message;
      }
      return payload;
    },
    replies,
    message,
  };
}

async function withSearchCommandMocks(mocks, runTest) {
  const previousSearchCommand = require.cache[searchCommandPath];
  const previousQueryManager = require.cache[vehicleQueryManagerPath];
  const previousSavedSearchManager = require.cache[savedSearchManagerPath];

  require.cache[vehicleQueryManagerPath] = {
    id: vehicleQueryManagerPath,
    filename: vehicleQueryManagerPath,
    loaded: true,
    exports: {
      queryVehicles: mocks.queryVehicles,
    },
  };
  require.cache[savedSearchManagerPath] = {
    id: savedSearchManagerPath,
    filename: savedSearchManagerPath,
    loaded: true,
    exports: {
      getSavedSearches: async () => [],
      deleteSavedSearch: async () => {},
      checkExistingSearch: mocks.checkExistingSearch,
      addSavedSearch: mocks.addSavedSearch,
    },
  };
  delete require.cache[searchCommandPath];

  try {
    const moduleExports = require(searchCommandPath);
    await runTest(moduleExports);
  } finally {
    if (previousSearchCommand) require.cache[searchCommandPath] = previousSearchCommand;
    else delete require.cache[searchCommandPath];

    if (previousQueryManager) require.cache[vehicleQueryManagerPath] = previousQueryManager;
    else delete require.cache[vehicleQueryManagerPath];

    if (previousSavedSearchManager) require.cache[savedSearchManagerPath] = previousSavedSearchManager;
    else delete require.cache[savedSearchManagerPath];
  }
}

test('invalid make returns ephemeral validation embed and stops query', async () => {
  let queryCalled = false;
  const interaction = makeInteraction({
    location: 'boise',
    make: 'not-a-real-make',
    model: 'ANY',
    year: 'ANY',
    status: 'ACTIVE',
  });

  await withSearchCommandMocks(
    {
      queryVehicles: async () => {
        queryCalled = true;
        return [];
      },
      checkExistingSearch: async () => false,
      addSavedSearch: async () => {},
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
    }
  );

  assert.equal(queryCalled, false);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].ephemeral, true);
  assert.equal(interaction.replies[0].embeds[0].data.title, 'Available Vehicle Makes');
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
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
    }
  );

  assert.equal(interaction.replies.length, 1);
  const payload = interaction.replies[0];
  assert.match(payload.embeds[0].data.description, /No Results Found/);

  const buttons = payload.components[0].components.map((component) => component.data);
  assert.equal(buttons[0].label, 'Previous');
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].label, 'Next');
  assert.equal(buttons[1].disabled, true);
  assert.equal(buttons[2].label, 'Save Search');

  await interaction.message.collector.emitEnd();
  assert.equal(interaction.message.edits.length, 1);
  assert.deepEqual(interaction.message.edits[0].components, []);
});

test('save-search button flow calls checkExistingSearch and addSavedSearch', async () => {
  const now = new Date().toISOString();
  const interaction = makeInteraction({
    location: 'boise',
    make: 'TOYOTA',
    model: 'CAMRY',
    year: '2005',
    status: 'ACTIVE',
  });

  const addSavedSearchCalls = [];
  const existingChecks = [];

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [
        {
          yard_name: 'BOISE',
          row_number: 7,
          vehicle_make: 'TOYOTA',
          vehicle_model: 'CAMRY',
          vehicle_year: 2005,
          first_seen: now,
          last_updated: now,
          notes: '',
        },
      ],
      checkExistingSearch: async (...args) => {
        existingChecks.push(args);
        return false;
      },
      addSavedSearch: async (...args) => {
        addSavedSearchCalls.push(args);
      },
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);

      const saveButtonCustomId = interaction.replies[0].components[0].components[2].data.custom_id;

      const buttonInteraction = {
        customId: saveButtonCustomId,
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
      assert.match(buttonInteraction.replyCalls[0].content, /saved successfully/i);
    }
  );
});

test('save-search for ALL location uses canonical yard ID for duplicate detection and insert', async () => {
  const now = new Date().toISOString();
  const interaction = makeInteraction({
    location: 'all',
    make: 'ANY',
    model: 'ANY',
    year: 'ANY',
    status: 'ACTIVE',
  });

  const addSavedSearchCalls = [];
  const existingChecks = [];

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [
        {
          yard_name: 'BOISE',
          row_number: 1,
          vehicle_make: 'FORD',
          vehicle_model: 'FOCUS',
          vehicle_year: 2008,
          first_seen: now,
          last_updated: now,
          notes: '',
        },
      ],
      checkExistingSearch: async (...args) => {
        existingChecks.push(args);
        return false;
      },
      addSavedSearch: async (...args) => {
        addSavedSearchCalls.push(args);
      },
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);

      const saveButtonCustomId = interaction.replies[0].components[0].components[2].data.custom_id;
      const buttonInteraction = {
        customId: saveButtonCustomId,
        user: { id: 'user-1', tag: 'user-1#0001' },
        async reply() {},
        async update() {},
      };

      await interaction.message.collector.emitCollect(buttonInteraction);
    }
  );

  const expectedCanonicalAll = '1020,1021,1022,1099,1119,999999';
  assert.equal(existingChecks.length, 1);
  assert.equal(existingChecks[0][1], expectedCanonicalAll);
  assert.equal(addSavedSearchCalls.length, 1);
  assert.equal(addSavedSearchCalls[0][2], expectedCanonicalAll);
});

test('duplicate saved search does not call addSavedSearch', async () => {
  const now = new Date().toISOString();
  const interaction = makeInteraction({
    location: 'boise',
    make: 'TOYOTA',
    model: 'CAMRY',
    year: '2005',
    status: 'ACTIVE',
  });

  let addCalls = 0;
  let duplicateReply;

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [
        {
          yard_name: 'BOISE',
          row_number: 2,
          vehicle_make: 'TOYOTA',
          vehicle_model: 'CAMRY',
          vehicle_year: 2005,
          first_seen: now,
          last_updated: now,
          notes: '',
        },
      ],
      checkExistingSearch: async () => true,
      addSavedSearch: async () => {
        addCalls += 1;
      },
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);

      const saveButtonCustomId = interaction.replies[0].components[0].components[2].data.custom_id;
      const buttonInteraction = {
        customId: saveButtonCustomId,
        user: { id: 'user-1', tag: 'user-1#0001' },
        async reply(payload) {
          duplicateReply = payload;
        },
        async update() {},
      };

      await interaction.message.collector.emitCollect(buttonInteraction);
    }
  );

  assert.equal(addCalls, 0);
  assert.match(duplicateReply.content, /already been saved/i);
});

test('parameterStore enforces TTL and max-entry limits', async () => {
  await withSearchCommandMocks(
    {
      queryVehicles: async () => [],
      checkExistingSearch: async () => false,
      addSavedSearch: async () => {},
    },
    async ({ __testables }) => {
      let now = 0;
      __testables.resetParameterStore();
      __testables.setNowProvider(() => now);
      __testables.setParameterStoreConfig({ maxEntries: 2, ttlMs: 100 });

      const hashA = __testables.generateHash('A');
      const hashB = __testables.generateHash('B');
      const hashC = __testables.generateHash('C'); // should evict oldest (A)

      assert.equal(__testables.getParameterStoreSize(), 2);
      assert.equal(__testables.resolveHash(hashA), undefined);
      assert.equal(__testables.resolveHash(hashB), 'B');
      assert.equal(__testables.resolveHash(hashC), 'C');

      now = 250; // expire B/C
      __testables.pruneParameterStore();
      assert.equal(__testables.getParameterStoreSize(), 0);

      __testables.resetParameterStore();
      __testables.resetNowProvider();
      __testables.setParameterStoreConfig({ maxEntries: 5000, ttlMs: 10 * 60 * 1000 });
    }
  );
});
