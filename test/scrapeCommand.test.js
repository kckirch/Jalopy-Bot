const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const scrapeCommandPath = path.join(repoRoot, 'src/bot/commands/scrapeCommand.js');
const universalWebScrapePath = path.join(repoRoot, 'src/scraping/universalWebScrape.js');
const scrapeLockPath = path.join(repoRoot, 'src/scraping/scrapeLock.js');
const utilsPath = path.join(repoRoot, 'src/bot/utils/utils.js');

function createInteraction({ location, make, model }) {
  const values = { location, make, model };
  const replies = [];

  return {
    user: { id: 'user-1' },
    memberPermissions: {
      has() {
        return true;
      },
    },
    options: {
      getString(name) {
        return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null;
      },
    },
    async reply(payload) {
      replies.push(payload);
      return payload;
    },
    get replies() {
      return replies;
    },
  };
}

async function withScrapeCommandMocks({ scrapeMock, sessionID }, runTest) {
  const previousScrape = require.cache[universalWebScrapePath];
  const previousUtils = require.cache[utilsPath];
  const previousCommand = require.cache[scrapeCommandPath];

  require.cache[universalWebScrapePath] = {
    id: universalWebScrapePath,
    filename: universalWebScrapePath,
    loaded: true,
    exports: { universalWebScrape: scrapeMock },
  };
  require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: { getSessionID: () => sessionID },
  };
  delete require.cache[scrapeCommandPath];

  try {
    const { handleScrapeCommand } = require(scrapeCommandPath);
    await runTest(handleScrapeCommand);
  } finally {
    if (previousScrape) require.cache[universalWebScrapePath] = previousScrape;
    else delete require.cache[universalWebScrapePath];

    if (previousUtils) require.cache[utilsPath] = previousUtils;
    else delete require.cache[utilsPath];

    if (previousCommand) require.cache[scrapeCommandPath] = previousCommand;
    else delete require.cache[scrapeCommandPath];
  }
}

test('location=all triggers scrape of all configured yards with normalized make/model', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({ location: 'all', make: 'toyota', model: 'camry' });

  await withScrapeCommandMocks(
    {
      scrapeMock: async (options) => {
        scrapeCalls.push(options);
      },
      sessionID: '20260101',
    },
    async (handleScrapeCommand) => {
      await handleScrapeCommand(interaction);
    }
  );

  assert.equal(scrapeCalls.length, 6);
  assert.ok(scrapeCalls.some((call) => call.yardId === '1020'));
  assert.ok(scrapeCalls.some((call) => call.yardId === '1021'));
  assert.ok(scrapeCalls.some((call) => call.yardId === '1022'));
  assert.ok(scrapeCalls.some((call) => call.yardId === '1119'));
  assert.ok(scrapeCalls.some((call) => call.yardId === '1099'));
  assert.ok(scrapeCalls.some((call) => call.yardId === '999999'));
  assert.ok(scrapeCalls.every((call) => call.make === 'TOYOTA'));
  assert.ok(scrapeCalls.every((call) => call.model === 'CAMRY'));
  assert.ok(scrapeCalls.every((call) => call.sessionID === '20260101'));
  assert.ok(scrapeCalls.every((call) => call.shouldMarkInactive === false));
  assert.equal(interaction.replies.length, 1);
});

test('specific location routes to a single scrape call', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({ location: 'boise', make: 'honda', model: 'civic' });

  await withScrapeCommandMocks(
    {
      scrapeMock: async (options) => {
        scrapeCalls.push(options);
      },
      sessionID: '20260101',
    },
    async (handleScrapeCommand) => {
      await handleScrapeCommand(interaction);
    }
  );

  assert.equal(scrapeCalls.length, 1);
  assert.equal(scrapeCalls[0].yardId, 1020);
  assert.equal(scrapeCalls[0].make, 'HONDA');
  assert.equal(scrapeCalls[0].model, 'CIVIC');
  assert.equal(scrapeCalls[0].sessionID, '20260101');
  assert.equal(scrapeCalls[0].inventoryUrl, 'https://inventory.pickapartjalopyjungle.com/');
  assert.equal(scrapeCalls[0].shouldMarkInactive, false);
});

test('specific location full scrape (ANY/ANY) enables inactive reconciliation for scoped yard', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({ location: 'boise', make: null, model: null });

  await withScrapeCommandMocks(
    {
      scrapeMock: async (options) => {
        scrapeCalls.push(options);
      },
      sessionID: '20260101',
    },
    async (handleScrapeCommand) => {
      await handleScrapeCommand(interaction);
    }
  );

  assert.equal(scrapeCalls.length, 1);
  assert.equal(scrapeCalls[0].yardId, 1020);
  assert.equal(scrapeCalls[0].make, 'ANY');
  assert.equal(scrapeCalls[0].model, 'ANY');
  assert.equal(scrapeCalls[0].shouldMarkInactive, true);
});

test('location=trustypickapart routes to trusty config', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({ location: 'trustypickapart', make: 'ford', model: 'focus' });

  await withScrapeCommandMocks(
    {
      scrapeMock: async (options) => {
        scrapeCalls.push(options);
      },
      sessionID: '20260101',
    },
    async (handleScrapeCommand) => {
      await handleScrapeCommand(interaction);
    }
  );

  assert.equal(scrapeCalls.length, 1);
  assert.equal(scrapeCalls[0].inventoryUrl, 'https://inventory.trustypickapart.com/');
  assert.equal(scrapeCalls[0].yardId, '999999');
  assert.equal(scrapeCalls[0].shouldMarkInactive, false);
});

test('scrape command denies requests without elevated permissions', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({ location: 'boise', make: 'toyota', model: 'camry' });
  interaction.memberPermissions = { has: () => false };
  interaction.member = { roles: { cache: { some: () => false } } };

  await withScrapeCommandMocks(
    {
      scrapeMock: async (options) => {
        scrapeCalls.push(options);
      },
      sessionID: '20260101',
    },
    async (handleScrapeCommand) => {
      await handleScrapeCommand(interaction);
    }
  );

  assert.equal(scrapeCalls.length, 0);
  assert.equal(interaction.replies.length, 1);
  assert.deepEqual(interaction.replies[0], {
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  });
});

test('scrape command reports busy state when another scrape is already in progress', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({ location: 'boise', make: 'toyota', model: 'camry' });
  const { withScrapeLock, __testables } = require(scrapeLockPath);
  __testables.resetScrapeLockForTests();

  await withScrapeLock('scheduled:20260101', async () => {
    await withScrapeCommandMocks(
      {
        scrapeMock: async (options) => {
          scrapeCalls.push(options);
        },
        sessionID: '20260101',
      },
      async (handleScrapeCommand) => {
        await handleScrapeCommand(interaction);
      }
    );
  });

  assert.equal(scrapeCalls.length, 0);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].ephemeral, true);
  assert.match(interaction.replies[0].content, /already running/i);
});
