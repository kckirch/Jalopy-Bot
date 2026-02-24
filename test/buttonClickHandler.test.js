const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const handlerPath = path.join(repoRoot, 'src/bot/handlers/buttonClickHandler.js');
const searchCommandPath = path.join(repoRoot, 'src/bot/commands/searchCommand.js');

const { handleButtonClick } = require(handlerPath);

test('handleButtonClick quit updates interaction and stops collector when provided', async () => {
  let stopCalls = 0;
  const messageCollector = {
    stop() {
      stopCalls += 1;
    },
  };

  const updates = [];
  const interaction = {
    async update(payload) {
      updates.push(payload);
    },
  };

  await handleButtonClick(interaction, 'quit', messageCollector);

  assert.equal(stopCalls, 1);
  assert.equal(updates.length, 1);
  assert.match(updates[0].content, /operation cancelled/i);
  assert.deepEqual(updates[0].components, []);
});

test('handleButtonClick non-quit does nothing and does not throw', async () => {
  const interaction = {
    async update() {
      throw new Error('update should not be called');
    },
  };

  await handleButtonClick(interaction, 'some-other-button');
});

test('handleButtonClick routes saved-search quick actions to search command handler', async () => {
  const previousSearchCommand = require.cache[searchCommandPath];
  const routedHashes = [];

  require.cache[searchCommandPath] = {
    id: searchCommandPath,
    filename: searchCommandPath,
    loaded: true,
    exports: {
      handleSavedSearchQuickActionButton: async (_interaction, quickHash) => {
        routedHashes.push(quickHash);
      },
    },
  };

  try {
    const interaction = {
      async reply() {},
      async followUp() {},
    };

    await handleButtonClick(interaction, 'sq:abc123');
    assert.deepEqual(routedHashes, ['abc123']);
  } finally {
    if (previousSearchCommand) require.cache[searchCommandPath] = previousSearchCommand;
    else delete require.cache[searchCommandPath];
  }
});
