const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const commandPath = path.join(repoRoot, 'src/bot/commands/manualNotifyNewVehiclesCommand.js');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');

async function withManualNotifyCommandMocks(notifyNewVehicles, runTest) {
  const previousCommand = require.cache[commandPath];
  const previousDailyTasks = require.cache[dailyTasksPath];

  require.cache[dailyTasksPath] = {
    id: dailyTasksPath,
    filename: dailyTasksPath,
    loaded: true,
    exports: { notifyNewVehicles },
  };
  delete require.cache[commandPath];

  try {
    const { handleManualNotifyNewVehiclesCommand } = require(commandPath);
    await runTest(handleManualNotifyNewVehiclesCommand);
  } finally {
    if (previousCommand) require.cache[commandPath] = previousCommand;
    else delete require.cache[commandPath];

    if (previousDailyTasks) require.cache[dailyTasksPath] = previousDailyTasks;
    else delete require.cache[dailyTasksPath];
  }
}

test('handleManualNotifyNewVehiclesCommand executes notify for elevated users', async () => {
  let notifyCalls = 0;
  const interaction = {
    memberPermissions: {
      has() {
        return true;
      },
    },
    replyCalls: [],
    async reply(payload) {
      this.replyCalls.push(payload);
    },
  };

  await withManualNotifyCommandMocks(
    async () => {
      notifyCalls += 1;
    },
    async (handleManualNotifyNewVehiclesCommand) => {
      await handleManualNotifyNewVehiclesCommand(interaction);
    }
  );

  assert.equal(notifyCalls, 1);
  assert.equal(interaction.replyCalls.length, 1);
  assert.deepEqual(interaction.replyCalls[0], {
    content: 'New vehicles notification sent successfully.',
    ephemeral: true,
  });
});

test('handleManualNotifyNewVehiclesCommand denies non-elevated users', async () => {
  let notifyCalls = 0;
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
    replyCalls: [],
    async reply(payload) {
      this.replyCalls.push(payload);
    },
  };

  await withManualNotifyCommandMocks(
    async () => {
      notifyCalls += 1;
    },
    async (handleManualNotifyNewVehiclesCommand) => {
      await handleManualNotifyNewVehiclesCommand(interaction);
    }
  );

  assert.equal(notifyCalls, 0);
  assert.equal(interaction.replyCalls.length, 1);
  assert.deepEqual(interaction.replyCalls[0], {
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  });
});
