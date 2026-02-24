const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const savedSearchCommandPath = path.join(repoRoot, 'src/bot/commands/savedSearchCommand.js');
const savedSearchManagerPath = path.join(repoRoot, 'src/database/savedSearchManager.js');
const clientPath = path.join(repoRoot, 'src/bot/utils/client.js');

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

function makeInteraction(userId = 'user-1', location = null) {
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
  };
}

async function withSavedSearchCommandMocks(mocks, runTest) {
  const previousSavedSearchCommand = require.cache[savedSearchCommandPath];
  const previousSavedSearchManager = require.cache[savedSearchManagerPath];
  const previousClient = require.cache[clientPath];

  require.cache[savedSearchManagerPath] = {
    id: savedSearchManagerPath,
    filename: savedSearchManagerPath,
    loaded: true,
    exports: {
      getSavedSearches: mocks.getSavedSearches,
      deleteSavedSearch: mocks.deleteSavedSearch,
      checkExistingSearch: async () => false,
      addSavedSearch: async () => {},
    },
  };
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      client: mocks.client,
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

    if (previousClient) require.cache[clientPath] = previousClient;
    else delete require.cache[clientPath];
  }
}

test('savedsearch command replies with no-results message when user has no saved searches', async () => {
  const interaction = makeInteraction('user-empty');
  let dmSendCount = 0;

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [],
      deleteSavedSearch: async () => {},
      client: {
        users: {
          fetch: async () => ({
            createDM: async () => ({
              send: async () => {
                dmSendCount += 1;
              },
            }),
          }),
        },
      },
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.deferReplyCalls[0].ephemeral, true);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0].content, /no saved searches/i);
  assert.equal(dmSendCount, 0);
});

test('savedsearch command sends DM when searches exist and confirms in interaction reply', async () => {
  const interaction = makeInteraction('user-has-searches');
  const dmPayloads = [];
  let collector;
  let dmEditCalls = [];

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 1,
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: '2000-2005',
          status: 'ACTIVE',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
      deleteSavedSearch: async () => {},
      client: {
        users: {
          fetch: async () => ({
            createDM: async () => ({
              send: async (payload) => {
                dmPayloads.push(payload);
                return {
                  edit: async (editPayload) => {
                    dmEditCalls.push(editPayload);
                  },
                  createMessageComponentCollector: () => {
                    collector = new FakeCollector();
                    return collector;
                  },
                };
              },
            }),
          }),
        },
      },
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);
      await collector.emitEnd();
    }
  );

  assert.equal(dmPayloads.length, 1);
  assert.ok(Array.isArray(dmPayloads[0].embeds));
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0].content, /check your DMs/i);
  assert.equal(dmEditCalls.length, 1);
  assert.deepEqual(dmEditCalls[0].components, []);
});

test('delete button removes saved search and updates DM state', async () => {
  const interaction = makeInteraction('user-delete-test');
  const deleteCalls = [];
  let collector;
  let updatedPayload;

  await withSavedSearchCommandMocks(
    {
      getSavedSearches: async () => [
        {
          id: 42,
          yard_name: 'BOISE',
          make: 'HONDA',
          model: 'CIVIC',
          year_range: 'ANY',
          status: 'ACTIVE',
          create_date: new Date().toISOString(),
          update_date: new Date().toISOString(),
        },
      ],
      deleteSavedSearch: async (id) => {
        deleteCalls.push(id);
      },
      client: {
        users: {
          fetch: async () => ({
            createDM: async () => ({
              send: async () => ({
                edit: async () => {},
                createMessageComponentCollector: () => {
                  collector = new FakeCollector();
                  return collector;
                },
              }),
            }),
          }),
        },
      },
    },
    async (handleSavedSearchCommand) => {
      await handleSavedSearchCommand(interaction);

      const buttonInteraction = {
        customId: 'delete:0',
        user: { id: 'user-delete-test' },
        async update(payload) {
          updatedPayload = payload;
        },
      };
      await collector.emitCollect(buttonInteraction);
    }
  );

  assert.deepEqual(deleteCalls, [42]);
  assert.match(updatedPayload.content, /all saved searches have been deleted/i);
  assert.deepEqual(updatedPayload.components, []);
});
