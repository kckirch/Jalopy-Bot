const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const discordBotMainPath = path.join(repoRoot, 'src/bot/discordBotMain.js');
const clientPath = path.join(repoRoot, 'src/bot/utils/client.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');
const buttonHandlerPath = path.join(repoRoot, 'src/bot/handlers/buttonClickHandler.js');
const autocompleteHandlerPath = path.join(repoRoot, 'src/bot/handlers/autocompleteHandler.js');
const scrapeCommandPath = path.join(repoRoot, 'src/bot/commands/scrapeCommand.js');
const searchCommandPath = path.join(repoRoot, 'src/bot/commands/searchCommand.js');
const savedSearchCommandPath = path.join(repoRoot, 'src/bot/commands/savedSearchCommand.js');
const dailySavedSearchCommandPath = path.join(repoRoot, 'src/bot/commands/dailySavedSearchCommand.js');
const runTestSchedulerCommandPath = path.join(repoRoot, 'src/bot/commands/runTestSchedulerCommand.js');
const commandsCommandPath = path.join(repoRoot, 'src/bot/commands/commandsCommand.js');
const manualNotifyCommandPath = path.join(repoRoot, 'src/bot/commands/manualNotifyNewVehiclesCommand.js');
const testGitPushCommandPath = path.join(repoRoot, 'src/bot/commands/testGitPushDB.js');

function noopHandler() {}

async function withDiscordBotMainMocks(runTest) {
  const targets = [
    discordBotMainPath,
    clientPath,
    databasePath,
    schedulerPath,
    buttonHandlerPath,
    autocompleteHandlerPath,
    scrapeCommandPath,
    searchCommandPath,
    savedSearchCommandPath,
    dailySavedSearchCommandPath,
    runTestSchedulerCommandPath,
    commandsCommandPath,
    manualNotifyCommandPath,
    testGitPushCommandPath,
  ];

  const previous = new Map();
  for (const target of targets) {
    previous.set(target, require.cache[target]);
    delete require.cache[target];
  }

  const handlers = {};
  const state = {
    loginCalls: 0,
    setupDatabaseCalls: 0,
    startScheduledTasksCalls: 0,
  };

  const client = {
    on(eventName, handler) {
      handlers[eventName] = handler;
    },
    async login() {
      state.loginCalls += 1;
    },
  };

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { client },
  };

  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {
      setupDatabase: async () => {
        state.setupDatabaseCalls += 1;
      },
    },
  };

  require.cache[schedulerPath] = {
    id: schedulerPath,
    filename: schedulerPath,
    loaded: true,
    exports: {
      startScheduledTasks: () => {
        state.startScheduledTasksCalls += 1;
      },
    },
  };

  require.cache[buttonHandlerPath] = {
    id: buttonHandlerPath,
    filename: buttonHandlerPath,
    loaded: true,
    exports: { handleButtonClick: noopHandler },
  };
  require.cache[autocompleteHandlerPath] = {
    id: autocompleteHandlerPath,
    filename: autocompleteHandlerPath,
    loaded: true,
    exports: { handleAutocompleteInteraction: noopHandler },
  };

  require.cache[scrapeCommandPath] = {
    id: scrapeCommandPath,
    filename: scrapeCommandPath,
    loaded: true,
    exports: { handleScrapeCommand: noopHandler },
  };
  require.cache[searchCommandPath] = {
    id: searchCommandPath,
    filename: searchCommandPath,
    loaded: true,
    exports: { handleSearchCommand: noopHandler },
  };
  require.cache[savedSearchCommandPath] = {
    id: savedSearchCommandPath,
    filename: savedSearchCommandPath,
    loaded: true,
    exports: { handleSavedSearchCommand: noopHandler },
  };
  require.cache[dailySavedSearchCommandPath] = {
    id: dailySavedSearchCommandPath,
    filename: dailySavedSearchCommandPath,
    loaded: true,
    exports: { handleDailySavedSearchCommand: noopHandler },
  };
  require.cache[runTestSchedulerCommandPath] = {
    id: runTestSchedulerCommandPath,
    filename: runTestSchedulerCommandPath,
    loaded: true,
    exports: { handleRunTestSchedulerCommand: noopHandler },
  };
  require.cache[commandsCommandPath] = {
    id: commandsCommandPath,
    filename: commandsCommandPath,
    loaded: true,
    exports: { handleCommandsCommand: noopHandler },
  };
  require.cache[manualNotifyCommandPath] = {
    id: manualNotifyCommandPath,
    filename: manualNotifyCommandPath,
    loaded: true,
    exports: { handleManualNotifyNewVehiclesCommand: noopHandler },
  };
  require.cache[testGitPushCommandPath] = {
    id: testGitPushCommandPath,
    filename: testGitPushCommandPath,
    loaded: true,
    exports: { handleRunTestGitPushDBCommand: noopHandler },
  };

  try {
    require(discordBotMainPath);
    await runTest({ handlers, state });
  } finally {
    for (const target of targets) {
      if (previous.get(target)) require.cache[target] = previous.get(target);
      else delete require.cache[target];
    }
  }
}

test('discordBotMain logs in once and initializes scheduled tasks only once across repeated ready events', async () => {
  await withDiscordBotMainMocks(async ({ handlers, state }) => {
    assert.equal(state.setupDatabaseCalls, 1);
    assert.equal(state.loginCalls, 1);
    assert.ok(typeof handlers.ready === 'function');

    await handlers.ready({ user: { tag: 'jalopy#0001' } });
    await handlers.ready({ user: { tag: 'jalopy#0001' } });

    assert.equal(state.startScheduledTasksCalls, 1);
  });
});
