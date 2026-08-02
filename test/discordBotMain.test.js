const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const discordBotMainPath = path.join(repoRoot, 'src/bot/discordBotMain.js');
const clientPath = path.join(repoRoot, 'src/bot/utils/client.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');
const interactionHandlerPath = path.join(repoRoot, 'src/bot/handlers/interactionHandler.js');

function noopHandler() {}

async function withDiscordBotMainMocks(runTest, mocks = {}) {
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
      if (mocks.login) {
        return mocks.login();
      }
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
        if (mocks.setupDatabase) {
          return mocks.setupDatabase();
        }
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
        if (mocks.startScheduledTasks) {
          return mocks.startScheduledTasks();
        }
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

test('discordBotMain redacts startup errors', async () => {
  const setupDetails = 'private database /home/kc/private-inventory.db';
  const schedulerDetails = 'private scheduler value 123456789';
  const loginDetails = 'private Discord token value';

  const consoleCalls = await captureConsole(async () => {
    await withDiscordBotMainMocks(
      async ({ handlers }) => {
        await new Promise((resolve) => setImmediate(resolve));
        await handlers.clientReady({ user: { tag: 'jalopy#0001' } });
      },
      {
        setupDatabase: async () => {
          throw new TypeError(setupDetails);
        },
        startScheduledTasks: () => {
          throw new RangeError(schedulerDetails);
        },
        login: async () => {
          throw new URIError(loginDetails);
        },
      }
    );
  });
  const consoleText = joinedConsoleText(consoleCalls);

  assert.match(consoleText, /Failed to set up database: TypeError/);
  assert.match(consoleText, /Failed to start scheduled tasks: RangeError/);
  assert.match(consoleText, /Failed to login: URIError/);
  assert.equal(consoleText.includes(setupDetails), false);
  assert.equal(consoleText.includes(schedulerDetails), false);
  assert.equal(consoleText.includes(loginDetails), false);
});
