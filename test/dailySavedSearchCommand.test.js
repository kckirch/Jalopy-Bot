const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const commandPath = path.join(repoRoot, 'src/bot/commands/dailySavedSearchCommand.js');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');

async function withDailySavedSearchCommandMock(processDailySavedSearches, runTest) {
  const previousCommand = require.cache[commandPath];
  const previousDailyTasks = require.cache[dailyTasksPath];

  require.cache[dailyTasksPath] = {
    id: dailyTasksPath,
    filename: dailyTasksPath,
    loaded: true,
    exports: { processDailySavedSearches },
  };
  delete require.cache[commandPath];

  try {
    const { handleDailySavedSearchCommand } = require(commandPath);
    await runTest(handleDailySavedSearchCommand);
  } finally {
    if (previousCommand) require.cache[commandPath] = previousCommand;
    else delete require.cache[commandPath];

    if (previousDailyTasks) require.cache[dailyTasksPath] = previousDailyTasks;
    else delete require.cache[dailyTasksPath];
  }
}

function createInteraction() {
  return {
    deferred: false,
    editReplies: [],
    replies: [],
    replied: false,
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.editReplies.push(payload);
    },
    async reply(payload) {
      this.replies.push(payload);
      this.replied = true;
    },
  };
}

test('daily saved-search command defers and reports successful processing', async () => {
  const interaction = createInteraction();
  let processCalls = 0;

  await withDailySavedSearchCommandMock(
    async () => { processCalls += 1; },
    async (handleDailySavedSearchCommand) => {
      await handleDailySavedSearchCommand(interaction);
    }
  );

  assert.equal(processCalls, 1);
  assert.equal(interaction.deferred, true);
  assert.deepEqual(interaction.editReplies, [
    'Daily saved searches processed successfully.',
  ]);
  assert.deepEqual(interaction.replies, []);
});

test('daily saved-search command edits a deferred reply after processing fails', async () => {
  const interaction = createInteraction();
  const privateErrorDetails = 'private-user /home/kc/private-file';

  const consoleCalls = await captureConsole(async () => {
    await withDailySavedSearchCommandMock(
      async () => { throw new Error(privateErrorDetails); },
      async (handleDailySavedSearchCommand) => {
        await handleDailySavedSearchCommand(interaction);
      }
    );
  });

  assert.deepEqual(interaction.editReplies, [
    'An error occurred while processing daily saved searches.',
  ]);
  assert.deepEqual(interaction.replies, []);
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('daily saved-search command sends an initial error reply when deferral fails', async () => {
  const interaction = createInteraction();
  const privateErrorDetails = 'private-user /home/kc/private-file';
  interaction.deferReply = async () => {
    throw new Error(privateErrorDetails);
  };

  const consoleCalls = await captureConsole(async () => {
    await withDailySavedSearchCommandMock(
      async () => {},
      async (handleDailySavedSearchCommand) => {
        await handleDailySavedSearchCommand(interaction);
      }
    );
  });

  assert.deepEqual(interaction.editReplies, []);
  assert.deepEqual(interaction.replies, [{
    content: 'An error occurred while processing daily saved searches.',
    ephemeral: true,
  }]);
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});
