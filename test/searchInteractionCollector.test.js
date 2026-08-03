const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachSearchInteractionCollector,
} = require('../src/bot/handlers/searchInteractionCollector');
const {
  createSearchState,
} = require('../src/bot/handlers/searchInteractionActions');
const {
  storeInteractionParameters,
} = require('../src/bot/utils/interactionParameters');
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
    customId: storeInteractionParameters(`act:${action}|uid:user-1`),
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
    ['TOYOTA', 'CAMRY', 1020, 8],
  ]);
  assert.deepEqual(state, {
    location: 'boise',
    yardId: 1020,
    vehicles: [],
    suggestedModels: ['CAMRY SOLARA'],
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

  const expired = makeActionInteraction('next');
  expired.customId = 'missing-hash';
  await collector.emitCollect(expired);
  assert.match(expired.replies[0].content, /expired/i);

  const crossUser = makeActionInteraction('next', 'user-2');
  await collector.emitCollect(crossUser);
  assert.match(crossUser.replies[0].content, /permission/i);

  const unsupported = makeActionInteraction('unknown');
  await collector.emitCollect(unsupported);
  assert.match(unsupported.replies[0].content, /unsupported/i);
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
  assert.deepEqual(message.edits, [{ components: [] }]);

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
