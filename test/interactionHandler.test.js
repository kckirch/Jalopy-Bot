const test = require('node:test');
const assert = require('node:assert/strict');

const { createInteractionHandler } = require('../src/bot/handlers/interactionHandler');

const errorMessage = {
  content: 'An error occurred while processing your request.',
  ephemeral: true,
};

function createLogger() {
  return {
    errors: [],
    messages: [],
    error(...values) {
      this.errors.push(values);
    },
    log(...values) {
      this.messages.push(values);
    },
  };
}

function createInteraction(overrides = {}) {
  return {
    channelId: 'channel-1',
    commandName: 'search',
    customId: 'next',
    deferred: false,
    isAutocomplete: () => false,
    isButton: () => false,
    isCommand: () => false,
    options: { data: [] },
    replied: false,
    user: { id: 'user-1', tag: 'user#0001' },
    ...overrides,
  };
}

test('autocomplete interactions short-circuit command and button routing', async () => {
  const calls = [];
  const handler = createInteractionHandler({
    commandHandlers: { search: async () => calls.push('command') },
    ensureCommandAccess: async () => {
      calls.push('permission');
      return true;
    },
    handleAutocomplete: async () => calls.push('autocomplete'),
    handleButton: async () => calls.push('button'),
    logger: createLogger(),
  });

  await handler(createInteraction({ isAutocomplete: () => true }));

  assert.deepEqual(calls, ['autocomplete']);
});

test('commands dispatch after permission checks without fetching a guild member', async () => {
  const calls = [];
  const logger = createLogger();
  const interaction = createInteraction({
    isCommand: () => true,
    options: { data: [{ name: 'location', value: 'boise' }] },
  });
  const handler = createInteractionHandler({
    commandHandlers: {
      search: async (receivedInteraction) => calls.push(['search', receivedInteraction]),
    },
    ensureCommandAccess: async (receivedInteraction, commandName) => {
      calls.push(['permission', receivedInteraction, commandName]);
      return true;
    },
    logger,
  });

  await handler(interaction);

  assert.deepEqual(calls, [
    ['permission', interaction, 'search'],
    ['search', interaction],
  ]);
  assert.deepEqual(logger.messages, []);
});

test('denied commands do not reach their command handler', async () => {
  let commandCalls = 0;
  const handler = createInteractionHandler({
    commandHandlers: { scrape: async () => { commandCalls += 1; } },
    ensureCommandAccess: async () => false,
    logger: createLogger(),
  });

  await handler(createInteraction({ commandName: 'scrape', isCommand: () => true }));

  assert.equal(commandCalls, 0);
});

test('button interactions pass the custom ID to the button handler', async () => {
  const calls = [];
  const logger = createLogger();
  const interaction = createInteraction({ customId: 'quit', isButton: () => true });
  const handler = createInteractionHandler({
    handleButton: async (...values) => calls.push(values),
    logger,
  });

  await handler(interaction);

  assert.deepEqual(calls, [[interaction, 'quit']]);
  assert.deepEqual(logger.messages, []);
});

test('interaction errors use an initial reply when no response has started', async () => {
  const replies = [];
  const logger = createLogger();
  const interaction = createInteraction({
    isCommand: () => true,
    reply: async (payload) => replies.push(payload),
  });
  const handler = createInteractionHandler({
    commandHandlers: {
      search: async () => {
        throw new Error('forced failure');
      },
    },
    ensureCommandAccess: async () => true,
    logger,
  });

  await handler(interaction);

  assert.deepEqual(replies, [errorMessage]);
  assert.equal(logger.errors.length, 1);
  assert.deepEqual(logger.errors[0], ['Error processing interaction:', 'Error']);
});

test('interaction errors follow up after a response has started', async () => {
  const followUps = [];
  const interaction = createInteraction({
    deferred: true,
    followUp: async (payload) => followUps.push(payload),
    isButton: () => true,
  });
  const handler = createInteractionHandler({
    handleButton: async () => {
      throw new Error('forced failure');
    },
    logger: createLogger(),
  });

  await handler(interaction);

  assert.deepEqual(followUps, [errorMessage]);
});
