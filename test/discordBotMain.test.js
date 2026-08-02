const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const discordBotMainPath = path.join(repoRoot, 'src/bot/discordBotMain.js');
const clientPath = path.join(repoRoot, 'src/bot/utils/client.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');
const interactionHandlerPath = path.join(repoRoot, 'src/bot/handlers/interactionHandler.js');

function noopHandler() {}

async function withDiscordBotMainMocks(runTest) {
  const targets = [
    discordBotMainPath,
    clientPath,
    databasePath,
    schedulerPath,
    interactionHandlerPath,
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

  require.cache[interactionHandlerPath] = {
    id: interactionHandlerPath,
    filename: interactionHandlerPath,
    loaded: true,
    exports: { handleInteraction: noopHandler },
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

test('discordBotMain uses clientReady and initializes scheduled tasks only once across repeated events', async () => {
  await withDiscordBotMainMocks(async ({ handlers, state }) => {
    assert.equal(state.setupDatabaseCalls, 1);
    assert.equal(state.loginCalls, 1);
    assert.equal(handlers.ready, undefined);
    assert.ok(typeof handlers.clientReady === 'function');
    assert.equal(handlers.interactionCreate, noopHandler);

    await handlers.clientReady({ user: { tag: 'jalopy#0001' } });
    await handlers.clientReady({ user: { tag: 'jalopy#0001' } });

    assert.equal(state.startScheduledTasksCalls, 1);
  });
});
