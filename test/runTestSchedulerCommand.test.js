const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const commandPath = path.join(repoRoot, 'src/bot/commands/runTestSchedulerCommand.js');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');

async function withRunTestSchedulerCommandMocks(mocks, runTest) {
  const previousCommand = require.cache[commandPath];
  const previousScheduler = require.cache[schedulerPath];

  require.cache[schedulerPath] = {
    id: schedulerPath,
    filename: schedulerPath,
    loaded: true,
    exports: {
      runMissedMorningJobs: mocks.runMissedMorningJobs,
    },
  };
  delete require.cache[commandPath];

  try {
    const { handleRunTestSchedulerCommand } = require(commandPath);
    await runTest(handleRunTestSchedulerCommand);
  } finally {
    if (previousCommand) require.cache[commandPath] = previousCommand;
    else delete require.cache[commandPath];

    if (previousScheduler) require.cache[schedulerPath] = previousScheduler;
    else delete require.cache[schedulerPath];
  }
}

test('handleRunTestSchedulerCommand runs the missed morning jobs', async () => {
  let recoveryCalls = 0;
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
      runMissedMorningJobs: async () => { recoveryCalls += 1; },
    },
    async (handleRunTestSchedulerCommand) => {
      await handleRunTestSchedulerCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls, 1);
  assert.equal(recoveryCalls, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0], /completed successfully/i);
});

test('handleRunTestSchedulerCommand reports a missed-morning recovery failure', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-file';
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

  const consoleCalls = await captureConsole(async () => {
    await withRunTestSchedulerCommandMocks(
      {
        runMissedMorningJobs: async () => { throw new Error(privateErrorDetails); },
      },
      async (handleRunTestSchedulerCommand) => {
        await handleRunTestSchedulerCommand(interaction);
      }
    );
  });

  assert.equal(interaction.deferReplyCalls, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0], /an error occurred/i);
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('handleRunTestSchedulerCommand denies users without elevated permissions', async () => {
  let recoveryCalls = 0;
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
      runMissedMorningJobs: async () => { recoveryCalls += 1; },
    },
    async (handleRunTestSchedulerCommand) => {
      await handleRunTestSchedulerCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls, 0);
  assert.equal(recoveryCalls, 0);
  assert.equal(interaction.replyCalls.length, 1);
  assert.deepEqual(interaction.replyCalls[0], {
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  });
});
