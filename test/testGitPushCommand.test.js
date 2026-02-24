const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const commandPath = path.join(repoRoot, 'src/bot/commands/testGitPushDB.js');
const pushModulePath = path.join(repoRoot, 'src/notifications/pushToScrapedData.js');

async function withTestGitPushCommandMocks(pushToScrapedData, runTest) {
  const previousCommand = require.cache[commandPath];
  const previousPushModule = require.cache[pushModulePath];

  require.cache[pushModulePath] = {
    id: pushModulePath,
    filename: pushModulePath,
    loaded: true,
    exports: { pushToScrapedData },
  };
  delete require.cache[commandPath];

  try {
    const { handleRunTestGitPushDBCommand } = require(commandPath);
    await runTest(handleRunTestGitPushDBCommand);
  } finally {
    if (previousCommand) require.cache[commandPath] = previousCommand;
    else delete require.cache[commandPath];

    if (previousPushModule) require.cache[pushModulePath] = previousPushModule;
    else delete require.cache[pushModulePath];
  }
}

test('handleRunTestGitPushDBCommand executes push when user has elevated access', async () => {
  let pushCalls = 0;
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

  await withTestGitPushCommandMocks(
    async () => { pushCalls += 1; },
    async (handleRunTestGitPushDBCommand) => {
      await handleRunTestGitPushDBCommand(interaction);
    }
  );

  assert.equal(interaction.deferReplyCalls, 1);
  assert.equal(pushCalls, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0], /executed successfully/i);
});

test('handleRunTestGitPushDBCommand denies users without elevated access', async () => {
  let pushCalls = 0;
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
    replyCalls: [],
    async deferReply() {
      this.deferReplyCalls += 1;
    },
    async reply(payload) {
      this.replyCalls.push(payload);
    },
  };

  await withTestGitPushCommandMocks(
    async () => { pushCalls += 1; },
    async (handleRunTestGitPushDBCommand) => {
      await handleRunTestGitPushDBCommand(interaction);
    }
  );

  assert.equal(pushCalls, 0);
  assert.equal(interaction.deferReplyCalls, 0);
  assert.equal(interaction.replyCalls.length, 1);
  assert.deepEqual(interaction.replyCalls[0], {
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  });
});

