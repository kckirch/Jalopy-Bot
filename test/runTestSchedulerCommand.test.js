const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const commandPath = path.join(repoRoot, 'src/bot/commands/runTestSchedulerCommand.js');
const testSchedulerPath = path.join(repoRoot, 'src/notifications/testScheduler.js');

async function withRunTestSchedulerCommandMocks(mocks, runTest) {
  const previousCommand = require.cache[commandPath];
  const previousTestScheduler = require.cache[testSchedulerPath];

  require.cache[testSchedulerPath] = {
    id: testSchedulerPath,
    filename: testSchedulerPath,
    loaded: true,
    exports: {
      performScrape: mocks.performScrape,
      processSearches: mocks.processSearches,
    },
  };
  delete require.cache[commandPath];

  try {
    const { handleRunTestSchedulerCommand } = require(commandPath);
    await runTest(handleRunTestSchedulerCommand);
  } finally {
    if (previousCommand) require.cache[commandPath] = previousCommand;
    else delete require.cache[commandPath];

    if (previousTestScheduler) require.cache[testSchedulerPath] = previousTestScheduler;
    else delete require.cache[testSchedulerPath];
  }
}

test('handleRunTestSchedulerCommand calls performScrape and processSearches', async () => {
  let scrapeCalls = 0;
  let processCalls = 0;
  const interaction = {
    memberPermissions: {
      has() {
        return true;
      },
    },
    deferReplyCalls: 0,
    editReplyCalls: [],
    async deferReply() {
      this.deferReplyCalls += 1;
    },
    async editReply(payload) {
      this.editReplyCalls.push(payload);
    },
  };

  await withRunTestSchedulerCommandMocks(
    {
      performScrape: async () => { scrapeCalls += 1; },
      processSearches: async () => { processCalls += 1; },
    },
    async (handleRunTestSchedulerCommand) => {
      await handleRunTestSchedulerCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls, 1);
  assert.equal(scrapeCalls, 1);
  assert.equal(processCalls, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0], /executed successfully/i);
});

test('handleRunTestSchedulerCommand reports failure when test scheduler throws', async () => {
  const interaction = {
    memberPermissions: {
      has() {
        return true;
      },
    },
    deferReplyCalls: 0,
    editReplyCalls: [],
    async deferReply() {
      this.deferReplyCalls += 1;
    },
    async editReply(payload) {
      this.editReplyCalls.push(payload);
    },
  };

  await withRunTestSchedulerCommandMocks(
    {
      performScrape: async () => { throw new Error('forced-failure'); },
      processSearches: async () => {},
    },
    async (handleRunTestSchedulerCommand) => {
      await handleRunTestSchedulerCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0], /an error occurred/i);
});

test('handleRunTestSchedulerCommand denies users without elevated permissions', async () => {
  let scrapeCalls = 0;
  let processCalls = 0;
  const interaction = {
    memberPermissions: {
      has() {
        return false;
      },
    },
    member: {
      roles: {
        cache: {
          some() {
            return false;
          },
        },
      },
    },
    deferReplyCalls: 0,
    editReplyCalls: [],
    replyCalls: [],
    async deferReply() {
      this.deferReplyCalls += 1;
    },
    async editReply(payload) {
      this.editReplyCalls.push(payload);
    },
    async reply(payload) {
      this.replyCalls.push(payload);
    },
  };

  await withRunTestSchedulerCommandMocks(
    {
      performScrape: async () => { scrapeCalls += 1; },
      processSearches: async () => { processCalls += 1; },
    },
    async (handleRunTestSchedulerCommand) => {
      await handleRunTestSchedulerCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls, 0);
  assert.equal(scrapeCalls, 0);
  assert.equal(processCalls, 0);
  assert.equal(interaction.replyCalls.length, 1);
  assert.deepEqual(interaction.replyCalls[0], {
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  });
});
