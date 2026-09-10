const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setImmediate, setTimeout: delay } = require('node:timers/promises');
const { Client, Events, InteractionType, Message } = require('discord.js');

const {
  attachSearchInteractionCollector,
} = require('../src/bot/handlers/searchInteractionCollector');
const {
  createSearchState,
} = require('../src/bot/handlers/searchInteractionActions');
const { buildSearchViewPayload } = require('../src/bot/utils/searchInteractionView');
const { getSearchGroups } = require('../src/database/vehicleSearchGroups');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

const criteria = Object.freeze({
  make: 'TOYOTA',
  model: 'CAMRY',
  yearRange: '2005',
  status: 'ACTIVE',
});

class FakeCollector {
  constructor(options) {
    this.options = options;
    this.handlers = {};
  }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
    return this;
  }

  async emitCollect(interaction) {
    await this.handlers.collect(interaction);
  }

  async emitEnd() {
    await this.handlers.end();
  }
}

function makeVehicle(index) {
  return {
    yard_name: 'BOISE',
    row_number: index,
    vehicle_make: 'TOYOTA',
    vehicle_model: 'CAMRY',
    vehicle_year: 2005,
    first_seen: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    last_updated: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
    notes: '',
  };
}

function makeMessage({ editError } = {}) {
  return {
    collector: null,
    edits: [],
    createMessageComponentCollector(options) {
      this.collector = new FakeCollector(options);
      return this.collector;
    },
    async edit(payload) {
      if (editError) {
        throw editError;
      }
      this.edits.push(payload);
    },
  };
}

function makeActionInteraction(action, userId = 'user-1') {
  return {
    customId: `search:${action}`,
    user: { id: userId },
    replies: [],
    updates: [],
    async reply(payload) {
      this.replies.push(payload);
    },
    async update(payload) {
      this.updates.push(payload);
    },
  };
}

function attachTestCollector(message, initialSearchState) {
  return attachSearchInteractionCollector({
    message,
    ownerId: 'user-1',
    initialSearchState,
    criteria,
  });
}

test('createSearchState queries normalized criteria and loads model suggestions', async () => {
  const queryCalls = [];
  const suggestionCalls = [];
  const state = await createSearchState('boise', criteria, {
    queryVehicles: async (...args) => {
      queryCalls.push(args);
      return [];
    },
    getModelSuggestionsForNoResults: async (...args) => {
      suggestionCalls.push(args);
      return ['CAMRY SOLARA'];
    },
  });

  assert.deepEqual(queryCalls, [
    [1020, 'TOYOTA', 'CAMRY', '2005', 'ACTIVE'],
  ]);
  assert.deepEqual(suggestionCalls, [
    ['TOYOTA', 'CAMRY', 'ALL', 8],
  ]);
  assert.deepEqual(state, {
    location: 'boise',
    yardId: 1020,
    vehicles: [],
    suggestedModels: ['CAMRY SOLARA'],
    knownModel: false,
    groups: getSearchGroups('TOYOTA', 'CAMRY'),
    currentPage: 0,
    totalPages: 0,
  });
});

test('collector owns pagination state and enforces its owner filter', async () => {
  const message = makeMessage();
  const initialSearchState = {
    location: 'boise',
    yardId: 1020,
    vehicles: Array.from({ length: 21 }, (_, index) => makeVehicle(index)),
    suggestedModels: [],
    currentPage: 0,
    totalPages: 2,
  };
  const collector = attachTestCollector(message, initialSearchState);

  assert.equal(collector.options.time, 120000);
  assert.equal(collector.options.filter({ user: { id: 'user-1' } }), true);
  assert.equal(collector.options.filter({ user: { id: 'user-2' } }), false);

  const interaction = makeActionInteraction('next');
  await collector.emitCollect(interaction);

  assert.equal(interaction.updates.length, 1);
  assert.equal(interaction.updates[0].embeds[0].data.footer.text, 'Page 2 of 2');
  const pagingButtons = interaction.updates[0].components[0].components;
  assert.equal(pagingButtons[0].data.disabled, false);
  assert.equal(pagingButtons[1].data.disabled, true);
});

test('collector rejects expired, cross-user, and unsupported actions', async () => {
  const collector = attachTestCollector(makeMessage(), {
    location: 'boise',
    yardId: 1020,
    vehicles: [],
    suggestedModels: [],
    currentPage: 0,
    totalPages: 0,
  });

  for (const customId of ['missing-hash', '', null, undefined, 12, 'act:save|uid:user-1']) {
    const expired = { ...makeActionInteraction('next'), customId };
    await collector.emitCollect(expired);
    assert.match(expired.replies[0].content, /expired/i);
    assert.deepEqual(expired.updates, []);
  }

  const crossUser = makeActionInteraction('next', 'user-2');
  await collector.emitCollect(crossUser);
  assert.match(crossUser.replies[0].content, /permission/i);

  for (const action of ['unknown', 'save|uid:user-1', 'next:extra', '']) {
    const unsupported = makeActionInteraction(action);
    await collector.emitCollect(unsupported);
    assert.match(unsupported.replies[0].content, /unsupported/i);
    assert.deepEqual(unsupported.updates, []);
  }
});

function makeRealSearchSession(client, messageId) {
  const message = {
    client,
    id: messageId,
    channelId: 'channel-1',
    guildId: null,
    edits: [],
    createMessageComponentCollector: Message.prototype.createMessageComponentCollector,
    async edit(payload) { this.edits.push(payload); },
  };
  const state = {
    location: 'boise',
    yardId: 1020,
    vehicles: Array.from({ length: 41 }, (_, index) => makeVehicle(index)),
    suggestedModels: [],
    currentPage: 0,
    totalPages: 3,
  };
  return { message, state, collector: attachTestCollector(message, state) };
}

function makeRealInteraction(messageId, userId = 'user-1') {
  return {
    ...makeActionInteraction('next', userId),
    id: `${messageId}:${userId}`,
    type: InteractionType.MessageComponent,
    message: { id: messageId },
    channelId: 'channel-1',
    guildId: null,
  };
}

test('real Discord collectors isolate simultaneous searches and reject other users', async (t) => {
  const client = new Client({ intents: [] });
  const first = makeRealSearchSession(client, 'message-1');
  const second = makeRealSearchSession(client, 'message-2');
  t.after(async () => {
    first.collector.stop();
    second.collector.stop();
    await client.destroy();
  });

  for (const [messageId, userId, expectedPages] of [
    ['message-1', 'user-2', [0, 0]],
    ['message-1', 'user-1', [1, 0]],
    ['message-2', 'user-1', [1, 1]],
    ['unrelated-message', 'user-1', [1, 1]],
  ]) {
    client.emit(Events.InteractionCreate, makeRealInteraction(messageId, userId));
    await setImmediate();
    assert.deepEqual([first.state.currentPage, second.state.currentPage], expectedPages);
  }
  assert.equal(first.collector.total, 1);
  assert.equal(second.collector.total, 1);
});

test('real Discord collector expiry disables controls and rejects later clicks', async (t) => {
  const client = new Client({ intents: [] });
  const { message, state, collector } = makeRealSearchSession(client, 'message-1');
  t.after(async () => {
    collector.stop();
    await client.destroy();
  });
  assert.equal(collector.options.time, 120000);
  const ended = once(collector, 'end');
  collector.resetTimer({ time: 1 });
  const [[, reason]] = await Promise.all([ended, delay(10)]);

  assert.equal(reason, 'time');
  assert.deepEqual(message.edits[0].components, []);
  assert.match(message.edits[0].content, /expired.*\/search/);
  assert.equal(client.listenerCount(Events.InteractionCreate), 0);
  const click = makeRealInteraction('message-1');
  client.emit(Events.InteractionCreate, click);
  await setImmediate();
  assert.equal(state.currentPage, 0);
  assert.deepEqual(click.updates, []);
  assert.deepEqual(click.replies, []);
});

test('search controls contain only short action IDs, never serialized search criteria', () => {
  const searchState = {
    location: 'boise',
    yardId: '1020,1021',
    vehicles: [],
    currentPage: 0,
    totalPages: 0,
  };
  const payload = buildSearchViewPayload(searchState, {
    ...criteria,
    model: '318|uid:someone:else; ' + 'X'.repeat(40),
  });

  assert.deepEqual(
    payload.components.flatMap((row) => row.components.map((component) => component.data.custom_id)),
    ['search:previous', 'search:next', 'search:save', 'search:manage', 'search:edit', 'search:any-year', 'search:all-locations', 'search:relocate']
  );
});

test('collector clears components on end and redacts cleanup failures', async () => {
  const initialSearchState = {
    location: 'boise',
    yardId: 1020,
    vehicles: [],
    suggestedModels: [],
    currentPage: 0,
    totalPages: 0,
  };
  const message = makeMessage();
  const collector = attachTestCollector(message, initialSearchState);
  await collector.emitEnd();
  assert.deepEqual(message.edits[0].components, []);
  assert.match(message.edits[0].content, /expired/);

  const privateErrorDetails = 'private Discord message 123456';
  const failingCollector = attachTestCollector(
    makeMessage({ editError: new URIError(privateErrorDetails) }),
    initialSearchState
  );
  const consoleCalls = await captureConsole(async () => {
    await failingCollector.emitEnd();
  });

  assert.match(
    joinedConsoleText(consoleCalls),
    /Error clearing expired search components: URIError/
  );
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});
