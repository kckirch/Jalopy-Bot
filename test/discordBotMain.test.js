const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Events } = require('discord.js');
const {
  runDiscordBotCli,
  startDiscordBot,
} = require('../src/bot/discordBotMain');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

function createClient(login = async () => {}) {
  const handlers = {};
  const state = { loginCalls: 0 };
  return {
    handlers,
    state,
    client: {
      on(eventName, handler) {
        handlers[eventName] = handler;
      },
      async login(token) {
        state.loginCalls += 1;
        state.loginToken = token;
        return login(token);
      },
    },
  };
}

test('Discord login and handlers wait for database setup to finish', async () => {
  let finishDatabaseSetup;
  const databaseReady = new Promise((resolve) => {
    finishDatabaseSetup = resolve;
  });
  const { client, handlers, state } = createClient();
  const interactionHandler = () => {};
  const startPromise = startDiscordBot({
    client,
    async setupDatabase() {
      await databaseReady;
    },
    startScheduledTasks() {},
    handleInteraction: interactionHandler,
    token: 'test-token',
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.loginCalls, 0);
  assert.deepEqual(handlers, {});

  finishDatabaseSetup();
  await startPromise;

  assert.equal(state.loginCalls, 1);
  assert.equal(state.loginToken, 'test-token');
  assert.equal(typeof handlers[Events.ClientReady], 'function');
  assert.equal(handlers[Events.InteractionCreate], interactionHandler);
});

test('database setup failure prevents Discord login', async () => {
  const setupError = new Error('simulated setup failure');
  const { client, handlers, state } = createClient();

  await assert.rejects(
    startDiscordBot({
      client,
      async setupDatabase() {
        throw setupError;
      },
      startScheduledTasks() {},
      handleInteraction() {},
      token: 'test-token',
    }),
    setupError
  );

  assert.equal(state.loginCalls, 0);
  assert.deepEqual(handlers, {});
});

test('scheduled tasks initialize once and retry after a failed ready event', async () => {
  const schedulerError = new RangeError('private scheduler value 123456789');
  const { client, handlers } = createClient();
  let schedulerCalls = 0;
  await startDiscordBot({
    client,
    async setupDatabase() {},
    async startScheduledTasks() {
      schedulerCalls += 1;
      if (schedulerCalls === 1) throw schedulerError;
    },
    handleInteraction() {},
    token: 'test-token',
  });

  const consoleCalls = await captureConsole(async () => {
    await handlers[Events.ClientReady]();
    await handlers[Events.ClientReady]();
    await handlers[Events.ClientReady]();
  });
  const consoleText = joinedConsoleText(consoleCalls);

  assert.equal(schedulerCalls, 2);
  assert.match(consoleText, /Failed to start scheduled tasks: RangeError/);
  assert.match(consoleText, /scheduled tasks already initialized/);
  assert.equal(consoleText.includes(schedulerError.message), false);
});

test('Discord bot CLI redacts startup errors and sets a failing exit code', async () => {
  const previousExitCode = process.exitCode;
  const privateDetails = 'private Discord token value';
  process.exitCode = 0;

  try {
    const consoleCalls = await captureConsole(() =>
      runDiscordBotCli(async () => {
        throw new URIError(privateDetails);
      })
    );
    const consoleText = joinedConsoleText(consoleCalls);

    assert.equal(process.exitCode, 1);
    assert.match(consoleText, /Failed to start Discord bot: URIError/);
    assert.equal(consoleText.includes(privateDetails), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('Discord bot process exits nonzero when its database cannot be opened', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-startup-failure-'));
  const blockingFile = path.join(tempDirectory, 'not-a-directory');
  const databasePath = path.join(blockingFile, 'vehicleInventory.db');
  fs.writeFileSync(blockingFile, 'blocks database directory creation');

  try {
    const result = spawnSync(process.execPath, ['src/bot/discordBotMain.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        VEHICLE_DB_PATH: databasePath,
        TOKEN: 'private-test-token',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(output, /Failed to start Discord bot: Error \[SQLITE_CANTOPEN\]/);
    assert.equal(output.includes(databasePath), false);
    assert.equal(output.includes('private-test-token'), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
