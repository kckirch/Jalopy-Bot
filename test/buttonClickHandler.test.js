const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const handlerPath = path.join(repoRoot, 'src/bot/handlers/buttonClickHandler.js');
const quickActionHandlerPath = path.join(
  repoRoot,
  'src/bot/handlers/savedSearchQuickActionHandler.js'
);

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

test('handleButtonClick routes saved-search quick actions to the dedicated handler', async () => {
  const previousQuickActionHandler = require.cache[quickActionHandlerPath];
  const routedHashes = [];

  require.cache[quickActionHandlerPath] = {
    id: quickActionHandlerPath,
    filename: quickActionHandlerPath,
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
    if (previousQuickActionHandler) {
      require.cache[quickActionHandlerPath] = previousQuickActionHandler;
    } else {
      delete require.cache[quickActionHandlerPath];
    }
  }
});

test('handleButtonClick redacts saved-search quick-action errors', async () => {
  const previousQuickActionHandler = require.cache[quickActionHandlerPath];
  const privateErrorDetails = 'private Discord user /home/kc/private-inventory.db';

  require.cache[quickActionHandlerPath] = {
    id: quickActionHandlerPath,
    filename: quickActionHandlerPath,
    loaded: true,
    exports: {
      handleSavedSearchQuickActionButton: async () => {
        throw new TypeError(privateErrorDetails);
      },
    },
  };

  try {
    const replies = [];
    const interaction = {
      deferred: false,
      replied: false,
      async reply(payload) {
        replies.push(payload);
      },
    };

    const consoleCalls = await captureConsole(async () => {
      await handleButtonClick(interaction, 'sq:private-hash');
    });

    assert.deepEqual(replies, [{
      content: 'Unable to process that quick action.',
      ephemeral: true,
    }]);
    assert.match(joinedConsoleText(consoleCalls), /Saved-search quick action failed: TypeError/);
    assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
  } finally {
    if (previousQuickActionHandler) {
      require.cache[quickActionHandlerPath] = previousQuickActionHandler;
    } else {
      delete require.cache[quickActionHandlerPath];
    }
  }
});
