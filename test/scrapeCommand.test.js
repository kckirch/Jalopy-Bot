const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleScrapeCommand,
} = require('../src/bot/commands/scrapeCommand');
const {
  withScrapeLock,
  __testables: scrapeLockTestables,
} = require('../src/scraping/scrapeLock');

function createInteraction({ location, make, model }) {
  const values = { location, make, model };
  const replies = [];
  const deferReplyCalls = [];
  const editReplyCalls = [];

  return {
    user: { id: 'user-1' },
    memberPermissions: {
      has() {
        return true;
      },
    },
    options: {
      getString(name) {
        return Object.prototype.hasOwnProperty.call(values, name)
          ? values[name]
          : null;
      },
    },
    async reply(payload) {
      replies.push(payload);
      return payload;
    },
    async deferReply(payload) {
      deferReplyCalls.push(payload);
    },
    async editReply(payload) {
      editReplyCalls.push(payload);
      return payload;
    },
    get replies() {
      return replies;
    },
    get deferReplyCalls() {
      return deferReplyCalls;
    },
    get editReplyCalls() {
      return editReplyCalls;
    },
  };
}

function createDependencies(scrapeCalls, sessionID = '20260101') {
  return {
    async scrape(options) {
      scrapeCalls.push(options);
    },
    getSession() {
      return sessionID;
    },
  };
}

test('location=all triggers every configured yard with normalized make/model', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: 'all',
    make: 'toyota',
    model: 'camry',
  });

  await handleScrapeCommand(interaction, createDependencies(scrapeCalls));

  assert.equal(scrapeCalls.length, 6);
  assert.deepEqual(
    new Set(scrapeCalls.map(({ yardId }) => yardId)),
    new Set(['1020', '1021', '1022', '1099', '1119', '999999'])
  );
  assert.ok(scrapeCalls.every((call) => call.make === 'TOYOTA'));
  assert.ok(scrapeCalls.every((call) => call.model === 'CAMRY'));
  assert.ok(scrapeCalls.every((call) => call.sessionID === '20260101'));
  assert.ok(scrapeCalls.every((call) => call.shouldMarkInactive === false));
  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  const completionEmbed = interaction.editReplyCalls[0].embeds[0].toJSON();
  assert.equal(
    completionEmbed.description,
    'Finished scraping all configured junkyards.'
  );
  assert.deepEqual(
    completionEmbed.fields.map(({ name, value }) => ({ name, value })),
    [
      { name: 'Make', value: 'TOYOTA' },
      { name: 'Model', value: 'CAMRY' },
      { name: 'Session ID', value: '20260101' },
    ]
  );
});

test('specific location routes to a single scrape call', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: 'boise',
    make: 'honda',
    model: 'civic',
  });

  await handleScrapeCommand(interaction, createDependencies(scrapeCalls));

  assert.equal(scrapeCalls.length, 1);
  assert.equal(scrapeCalls[0].yardId, 1020);
  assert.equal(scrapeCalls[0].make, 'HONDA');
  assert.equal(scrapeCalls[0].model, 'CIVIC');
  assert.equal(scrapeCalls[0].sessionID, '20260101');
  assert.equal(
    scrapeCalls[0].inventoryUrl,
    'https://inventory.pickapartjalopyjungle.com/'
  );
  assert.equal(scrapeCalls[0].shouldMarkInactive, false);
  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  const completionEmbed = interaction.editReplyCalls[0].embeds[0].toJSON();
  assert.equal(
    completionEmbed.description,
    'Scrape finished with these parameters:'
  );
  assert.deepEqual(
    completionEmbed.fields.map(({ name, value }) => ({ name, value })),
    [
      { name: 'Location', value: 'boise' },
      { name: 'Make', value: 'HONDA' },
      { name: 'Model', value: 'CIVIC' },
      { name: 'Session ID', value: '20260101' },
    ]
  );
});

test('specific location full scrape enables scoped inactive reconciliation', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: 'boise',
    make: null,
    model: null,
  });

  await handleScrapeCommand(interaction, createDependencies(scrapeCalls));

  assert.equal(scrapeCalls.length, 1);
  assert.equal(scrapeCalls[0].yardId, 1020);
  assert.equal(scrapeCalls[0].make, 'ANY');
  assert.equal(scrapeCalls[0].model, 'ANY');
  assert.equal(scrapeCalls[0].shouldMarkInactive, true);
});

test('location=trustypickapart routes to the Trusty configuration', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: 'trustypickapart',
    make: 'ford',
    model: 'focus',
  });

  await handleScrapeCommand(interaction, createDependencies(scrapeCalls));

  assert.equal(scrapeCalls.length, 1);
  assert.equal(
    scrapeCalls[0].inventoryUrl,
    'https://inventory.trustypickapart.com/'
  );
  assert.equal(scrapeCalls[0].yardId, '999999');
  assert.equal(scrapeCalls[0].shouldMarkInactive, false);
});

test('scrape command requires a location before deferring', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: null,
    make: 'toyota',
    model: 'camry',
  });

  await handleScrapeCommand(interaction, createDependencies(scrapeCalls));

  assert.deepEqual(interaction.replies, ['Please provide a location to scrape.']);
  assert.equal(interaction.deferReplyCalls.length, 0);
  assert.equal(interaction.editReplyCalls.length, 0);
  assert.equal(scrapeCalls.length, 0);
});

test('scrape command rejects unknown locations without broadening the scrape', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: 'not-a-configured-yard',
    make: 'toyota',
    model: 'camry',
  });

  await handleScrapeCommand(interaction, createDependencies(scrapeCalls));

  assert.equal(scrapeCalls.length, 0);
  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.deepEqual(interaction.editReplyCalls, [
    { content: 'Unknown location: not-a-configured-yard' },
  ]);
});

test('scrape command denies requests without elevated permissions', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: 'boise',
    make: 'toyota',
    model: 'camry',
  });
  interaction.memberPermissions = { has: () => false };
  interaction.member = { roles: { cache: { some: () => false } } };

  await handleScrapeCommand(interaction, createDependencies(scrapeCalls));

  assert.equal(scrapeCalls.length, 0);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.deferReplyCalls.length, 0);
  assert.equal(interaction.editReplyCalls.length, 0);
  assert.deepEqual(interaction.replies[0], {
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  });
});

test('scrape command preserves scraper failures for the interaction error boundary', async () => {
  const scrapeFailure = new Error('simulated scrape failure');
  const interaction = createInteraction({
    location: 'boise',
    make: 'toyota',
    model: 'camry',
  });

  await assert.rejects(
    handleScrapeCommand(interaction, {
      async scrape() {
        throw scrapeFailure;
      },
      getSession() {
        return '20260101';
      },
    }),
    scrapeFailure
  );

  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.editReplyCalls.length, 0);
});

test('scrape command reports busy state when another scrape holds the lock', async () => {
  const scrapeCalls = [];
  const interaction = createInteraction({
    location: 'boise',
    make: 'toyota',
    model: 'camry',
  });
  scrapeLockTestables.resetScrapeLockForTests();

  await withScrapeLock('scheduled:20260101', () =>
    handleScrapeCommand(interaction, createDependencies(scrapeCalls))
  );

  assert.equal(scrapeCalls.length, 0);
  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0].content, /already running/i);
});
